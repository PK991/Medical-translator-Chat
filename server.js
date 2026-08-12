import express from "express";
import dotenv from "dotenv";
import crypto from "crypto";
dotenv.config();

const app = express();
app.use(express.json({limit:"1mb"}));
app.use(express.static("public"));

const rooms = new Map();
const languages = {
  English:"English", Thai:"Thai", Arabic:"Arabic", Turkish:"Turkish",
  Bengali:"Bengali", Burmese:"Burmese", Chinese:"Chinese"
};
const id = () => String(Math.floor(100000 + Math.random()*900000)).replace(/(\d{3})(\d{3})/,"$1-$2");
const token = () => crypto.randomBytes(18).toString("hex");

async function translate(text, sourceLanguage, targets){
  const cleanTargets = [...new Set(targets.filter(Boolean).filter(x=>x!=="None").filter(x=>x!==sourceLanguage))];
  if (!cleanTargets.length) return {};
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");

  const schema = {
    type:"object",
    properties:Object.fromEntries(cleanTargets.map(l=>[l,{type:"string"}])),
    required:cleanTargets,
    additionalProperties:false
  };

  const response = await fetch("https://api.openai.com/v1/responses",{
    method:"POST",
    headers:{
      "Authorization":`Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type":"application/json"
    },
    body:JSON.stringify({
      model:process.env.OPENAI_MODEL || "gpt-5-mini",
      instructions:
        "You are a professional real-time chat translator. Translate faithfully and naturally. "+
        "Preserve clinical meaning, names, numbers, dosage, dates, and uncertainty. "+
        "Do not add explanations. Return only the requested JSON object.",
      input:`Source language: ${sourceLanguage}\nTarget languages: ${cleanTargets.join(", ")}\nText:\n${text}`,
      text:{format:{type:"json_schema",name:"translations",strict:true,schema}}
    })
  });
  if(!response.ok){
    const err = await response.text();
    throw new Error(`Translation API error ${response.status}: ${err}`);
  }
  const data = await response.json();
  const out = data.output_text;
  if(!out) throw new Error("No translation returned.");
  return JSON.parse(out);
}

app.post("/api/rooms", (req,res)=>{
  const {name, ownerName="Owner", sourceLanguage="English", secondLanguage="Thai", thirdLanguage="None"}=req.body;
  const roomId=id(), ownerToken=token();
  const room={
    id:roomId,name:(name||"Untitled Room").trim(),ownerToken,
    languages:{sourceLanguage,secondLanguage,thirdLanguage},
    participants:[{id:token(),name:ownerName,status:"approved",role:"owner"}],
    requests:[],messages:[],createdAt:Date.now()
  };
  rooms.set(roomId,room);
  res.json({roomId,ownerToken,roomName:room.name});
});

app.get("/api/rooms/:id",(req,res)=>{
  const r=rooms.get(req.params.id);
  if(!r) return res.status(404).json({error:"Room not found"});
  res.json({id:r.id,name:r.name,languages:r.languages,participants:r.participants,requests:r.requests,messages:r.messages});
});

app.post("/api/rooms/:id/join",(req,res)=>{
  const r=rooms.get(req.params.id);
  if(!r) return res.status(404).json({error:"Room not found"});
  const requestId=token(), participantToken=token();
  r.requests.push({requestId,participantToken,name:(req.body.name||"Participant").trim(),status:"pending"});
  res.json({requestId,participantToken,status:"pending"});
});

app.post("/api/rooms/:id/approve",(req,res)=>{
  const r=rooms.get(req.params.id);
  if(!r) return res.status(404).json({error:"Room not found"});
  if(req.body.ownerToken!==r.ownerToken) return res.status(403).json({error:"Owner authorization required"});
  const q=r.requests.find(x=>x.requestId===req.body.requestId);
  if(!q) return res.status(404).json({error:"Join request not found"});
  q.status="approved";
  if(!r.participants.some(p=>p.token===q.participantToken))
    r.participants.push({id:token(),token:q.participantToken,name:q.name,status:"approved",role:"participant"});
  res.json({ok:true});
});

app.post("/api/rooms/:id/messages", async (req,res)=>{
  const r=rooms.get(req.params.id);
  if(!r) return res.status(404).json({error:"Room not found"});
  const {senderName="Participant",text,sourceLanguage,secondLanguage,thirdLanguage}=req.body;
  if(!text?.trim()) return res.status(400).json({error:"Message is empty"});
  try{
    const targets=[secondLanguage||r.languages.secondLanguage, thirdLanguage||r.languages.thirdLanguage];
    const translations=await translate(text.trim(),sourceLanguage||r.languages.sourceLanguage,targets);
    const msg={id:token(),senderName,text:text.trim(),sourceLanguage:sourceLanguage||r.languages.sourceLanguage,translations,createdAt:Date.now()};
    r.messages.push(msg);
    res.json(msg);
  }catch(e){ res.status(502).json({error:e.message}); }
});

app.listen(process.env.PORT||3000,()=>console.log(`LinguaRoom running at http://localhost:${process.env.PORT||3000}`));
