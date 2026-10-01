import {NextResponse} from "next/server";
export const runtime="nodejs";
const ALLOWED=new Set(["audio/mpeg","audio/mp3","audio/mp4","audio/m4a","audio/wav","audio/x-wav","audio/webm","audio/ogg","audio/flac"]);
export async function POST(req:Request){
 const apiKey=process.env.OPENAI_API_KEY;
 if(!apiKey)return NextResponse.json({error:"OPENAI_API_KEY is not configured. Add it server-side to enable real MP3 transcription."},{status:503});
 const fd=await req.formData(); const file=fd.get("file"); const language=String(fd.get("language")||"");
 if(!(file instanceof File))return NextResponse.json({error:"Audio file is required."},{status:400});
 if(file.size>25*1024*1024)return NextResponse.json({error:"Audio file must be under 25 MB for this demo."},{status:413});
 if(!ALLOWED.has(file.type) && !file.name.toLowerCase().match(/\.(mp3|mp4|m4a|wav|webm|ogg|flac)$/))return NextResponse.json({error:"Unsupported audio format."},{status:415});
 const up=new FormData(); up.append("file",file,file.name); up.append("model","gpt-4o-transcribe"); if(language)up.append("language",language);
 const res=await fetch("https://api.openai.com/v1/audio/transcriptions",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`},body:up});
 const data=await res.json(); if(!res.ok)return NextResponse.json({error:data?.error?.message||"Transcription failed."},{status:res.status});
 return NextResponse.json({text:data.text||"",model:"gpt-4o-transcribe"});
}
