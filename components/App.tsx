"use client";
import {useEffect,useRef,useState} from "react";
import {getSupabase} from "@/lib/supabase";
import Call from "./Call";

export default function App(){
 const sb=useRef(getSupabase()).current;
 const [user,setUser]=useState<any>(null),[email,setEmail]=useState(""),[members,setMembers]=useState<any[]>([]);
 const [messages,setMessages]=useState<any[]>([]),[text,setText]=useState(""),[ai,setAi]=useState(false);
 const [file,setFile]=useState<File|null>(null),[call,setCall]=useState<any>(null),[toast,setToast]=useState("");
 const [online,setOnline]=useState(0);

 useEffect(()=>{let mounted=true;
  sb.auth.getUser().then(({data})=>mounted&&setUser(data.user));
  const msg=sb.channel("gosnaps-messages").on("postgres_changes",{event:"INSERT",schema:"public",table:"messages"},p=>setMessages(x=>[...x,p.new])).subscribe();
  sb.from("messages").select("*").order("created_at",{ascending:true}).limit(100).then(({data})=>data&&setMessages(data));
  const presence=sb.channel("gosnaps-presence",{config:{presence:{key:Math.random().toString(36)}}});
  presence.on("presence",{event:"sync"},()=>setOnline(Object.keys(presence.presenceState()).length)).subscribe(async s=>{if(s==="SUBSCRIBED")await presence.track({online_at:new Date().toISOString()})});
  return()=>{mounted=false;sb.removeChannel(msg);sb.removeChannel(presence)}
 },[sb]);

 async function login(){if(!email)return;let {error}=await sb.auth.signInWithOtp({email});setToast(error?.message||"Check your email for the sign-in link.");}
 async function loadMembers(){let {data}=await sb.from("profiles").select("id,display_name,created_at").limit(50);if(data)setMembers(data);}
 async function send(){
  if(ai){
   const q=text;setText("");const r=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:q})});const d=await r.json();setMessages(x=>[...x,{id:Date.now(),sender:"GOSNAPS AI",text:d.reply||d.error,created_at:new Date().toISOString()}]);return;
  }
  if(!user){setToast("Sign in first.");return}
  let attachment=null;
  if(file){const path=`${user.id}/${Date.now()}-${file.name}`;const u=await sb.storage.from("gosnaps-files").upload(path,file);if(u.error){setToast(u.error.message);return}attachment=path}
  const r=await sb.from("messages").insert({sender:user.email||"Member",text:text||"📎 File",attachment});
  if(r.error)setToast(r.error.message); else setToast("Sent");setText("");setFile(null);
 }
 function startCall(video:boolean){if(!user){setToast("Sign in before calling.");return}setCall({room:crypto.randomUUID(),video,initiator:true});}
 return <main className="wrap">
  <header><div className="logo">GO<span>SNAPS</span></div><div className="live">● {online} online</div></header>
  <section className="hero"><small>CONNECT • CHAT • CALL • CREATE</small><h1>One place for your people.</h1><p>Real-time conversations, AI, files and browser voice/video calling.</p></section>
  {!user?<section className="login"><input value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email address"/><button onClick={login}>Sign in</button></section>:<div className="welcome">Signed in as <b>{user.email}</b></div>}
  <nav><button className={!ai?"active":""} onClick={()=>setAi(false)}>💬 Messages</button><button className={ai?"active":""} onClick={()=>setAi(true)}>✨ AI</button><button onClick={()=>startCall(false)}>📞 Voice</button><button onClick={()=>startCall(true)}>🎥 Video</button><button onClick={loadMembers}>👥 Members</button></nav>
  {toast&&<div className="toast" onClick={()=>setToast("")}>{toast}</div>}
  {members.length>0&&<aside className="members">{members.map(m=><div key={m.id}>🟢 {m.display_name||"GOSNAPS member"}</div>)}</aside>}
  <section className="chat">{messages.map((m,i)=><article className={m.sender==="GOSNAPS AI"?"msg ai":"msg"} key={m.id??i}><b>{m.sender}</b><p>{m.text}</p>{m.attachment&&<small>📎 {m.attachment}</small>}</article>)}</section>
  <div className="composer"><label>📎<input type="file" onChange={e=>setFile(e.target.files?.[0]||null)}/></label><input value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder={ai?"Ask GOSNAPS AI…":"Message GOSNAPS…"}/><button onClick={send}>Send</button></div>
  {call&&<Call room={call.room} video={call.video} onClose={()=>setCall(null)}/>}
 </main>
}