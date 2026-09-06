import {NextResponse} from "next/server";
export async function POST(req:Request){
 try{const {message}=await req.json();if(!process.env.OPENAI_API_KEY)return NextResponse.json({error:"OPENAI_API_KEY is missing"},{status:500});
 const r=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify({model:"gpt-5-mini",input:message})});
 const d=await r.json();if(!r.ok)return NextResponse.json({error:d.error?.message||"AI failed"},{status:r.status});return NextResponse.json({reply:d.output_text||"No response."});
 }catch{return NextResponse.json({error:"Server error"},{status:500})}
}