import express from "express";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

const rooms = new Map();

const id = () =>
  String(Math.floor(100000 + Math.random() * 900000)).replace(
    /(\d{3})(\d{3})/,
    "$1-$2"
  );

const token = () => crypto.randomBytes(18).toString("hex");

async function translate(text, sourceLanguage, targets) {
  const cleanTargets = [
    ...new Set(
      targets
        .filter(Boolean)
        .filter((x) => x !== "None")
        .filter((x) => x !== sourceLanguage)
    ),
  ];

  if (!cleanTargets.length) return {};

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const schema = {
    type: "object",
    properties: Object.fromEntries(
      cleanTargets.map((language) => [language, { type: "string" }])
    ),
    required: cleanTargets,
    additionalProperties: false,
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      instructions:
        "You are a professional real-time chat translator. " +
        "Translate faithfully and naturally. Preserve clinical meaning, " +
        "names, numbers, medication names, dosage, dates, and uncertainty. " +
        "Do not add explanations. Return only the requested JSON object.",
      input:
        `Source language: ${sourceLanguage}\n` +
        `Target languages: ${cleanTargets.join(", ")}\n` +
        `Text:\n${text}`,
      text: {
        format: {
          type: "json_schema",
          name: "translations",
          strict: true,
          schema,
        },
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("OpenAI API error:", response.status, errText);

    if (response.status === 429) {
      throw new Error(
        "Translation service is temporarily unavailable because of API quota or rate limits."
      );
    }

    throw new Error(`Translation service error (${response.status}).`);
  }

  const data = await response.json();

  if (data.status === "incomplete") {
    console.error(
      "Incomplete OpenAI response:",
      JSON.stringify(data.incomplete_details || {}, null, 2)
    );
    throw new Error("Translation could not be completed.");
  }

  const message = data.output?.find((item) => item.type === "message");

  if (!message) {
    console.error("No message in OpenAI response:", JSON.stringify(data, null, 2));
    throw new Error("Translation service returned an unexpected response.");
  }

  const outputText = message.content?.find(
    (item) => item.type === "output_text"
  );

  if (!outputText?.text) {
    const refusal = message.content?.find((item) => item.type === "refusal");

    if (refusal?.refusal) {
      console.error("Translation refusal:", refusal.refusal);
      throw new Error("Translation request could not be processed.");
    }

    console.error(
      "No output_text in OpenAI response:",
      JSON.stringify(data, null, 2)
    );
    throw new Error("No translation text was returned.");
  }

  try {
    const parsed = JSON.parse(outputText.text);

    for (const language of cleanTargets) {
      if (typeof parsed[language] !== "string" || !parsed[language].trim()) {
        throw new Error(`Missing translation for ${language}`);
      }
    }

    return parsed;
  } catch (error) {
    console.error("Translation JSON parse/validation error:", error);
    console.error("Raw translation text:", outputText.text);
    throw new Error("Translation response could not be parsed.");
  }
}

app.post("/api/rooms", (req, res) => {
  const {
    name,
    ownerName = "Owner",
    sourceLanguage = "English",
    secondLanguage = "Thai",
    thirdLanguage = "None",
  } = req.body;

  const roomId = id();
  const ownerToken = token();

  const room = {
    id: roomId,
    name: (name || "Untitled Room").trim(),
    ownerToken,
    languages: {
      sourceLanguage,
      secondLanguage,
      thirdLanguage,
    },
    participants: [
      {
        id: token(),
        name: ownerName,
        status: "approved",
        role: "owner",
      },
    ],
    requests: [],
    messages: [],
    createdAt: Date.now(),
  };

  rooms.set(roomId, room);

  res.json({
    roomId,
    ownerToken,
    roomName: room.name,
  });
});

app.get("/api/rooms/:id", (req, res) => {
  const room = rooms.get(req.params.id);

  if (!room) {
    return res.status(404).json({ error: "Room not found" });
  }

  res.json({
    id: room.id,
    name: room.name,
    languages: room.languages,
    participants: room.participants,
    requests: room.requests,
    messages: room.messages,
  });
});

app.post("/api/rooms/:id/join", (req, res) => {
  const room = rooms.get(req.params.id);

  if (!room) {
    return res.status(404).json({ error: "Room not found" });
  }

  const requestId = token();
  const participantToken = token();

  room.requests.push({
    requestId,
    participantToken,
    name: (req.body.name || "Participant").trim(),
    status: "pending",
  });

  res.json({
    requestId,
    participantToken,
    status: "pending",
  });
});

app.post("/api/rooms/:id/approve", (req, res) => {
  const room = rooms.get(req.params.id);

  if (!room) {
    return res.status(404).json({ error: "Room not found" });
  }

  if (req.body.ownerToken !== room.ownerToken) {
    return res.status(403).json({ error: "Owner authorization required" });
  }

  const request = room.requests.find(
    (item) => item.requestId === req.body.requestId
  );

  if (!request) {
    return res.status(404).json({ error: "Join request not found" });
  }

  request.status = "approved";

  if (
    !room.participants.some(
      (participant) => participant.token === request.participantToken
    )
  ) {
    room.participants.push({
      id: token(),
      token: request.participantToken,
      name: request.name,
      status: "approved",
      role: "participant",
    });
  }

  res.json({ ok: true });
});

app.post("/api/rooms/:id/messages", async (req, res) => {
  const room = rooms.get(req.params.id);

  if (!room) {
    return res.status(404).json({ error: "Room not found" });
  }

  const {
    senderName = "Participant",
    text,
    sourceLanguage,
    secondLanguage,
    thirdLanguage,
  } = req.body;

  if (!text?.trim()) {
    return res.status(400).json({ error: "Message is empty" });
  }

  try {
    const actualSourceLanguage =
      sourceLanguage || room.languages.sourceLanguage;

    const targets = [
      secondLanguage || room.languages.secondLanguage,
      thirdLanguage || room.languages.thirdLanguage,
    ];

    const translations = await translate(
      text.trim(),
      actualSourceLanguage,
      targets
    );

    const message = {
      id: token(),
      senderName,
      text: text.trim(),
      sourceLanguage: actualSourceLanguage,
      translations,
      createdAt: Date.now(),
    };

    room.messages.push(message);
    res.json(message);
  } catch (error) {
    console.error("Message translation failed:", error);
    res.status(502).json({
      error: error.message || "Translation failed.",
    });
  }
});


app.delete("/api/rooms/:id",(req,res)=>{
  const room=rooms.get(req.params.id);
  if(!room) return res.status(404).json({error:"Room not found"});
  if(req.body?.ownerToken!==room.ownerToken){
    return res.status(403).json({error:"Only the room owner can delete this room"});
  }
  rooms.delete(req.params.id);
  res.json({ok:true,deletedRoomId:req.params.id});
});

app.listen(process.env.PORT || 3000, () => {
  console.log(
    `LinguaRoom running at http://localhost:${process.env.PORT || 3000}`
  );
});
