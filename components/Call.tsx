"use client";
import {useEffect,useRef,useState} from "react";
import {getSupabase} from "@/lib/supabase";
export default function Call({room,video,onClose}:{room:string;video:boolean;onClose:()=>void}){
 const sb=useRef(getSupabase()).current,pc=useRef<RTCPeerConnection|null>(null),ch=useRef<any>(null);
 const local=useRef<HTMLVideoElement>(null),remote=useRef<HTMLVideoElement>(null);const [status,setStatus]=useState("Starting…");
 useEffect(()=>{let active=true;
  (async()=>{
   try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true,video});
    if(!active)return;if(local.current)local.current.srcObject=stream;
    const conn=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});pc.current=conn;
    stream.getTracks().forEach(t=>conn.addTrack(t,stream));conn.ontrack=e=>{if(remote.current)remote.current.srcObject=e.streams[0]};
    ch.current=sb.channel("call:"+room);
    conn.onicecandidate=e=>e.candidate&&ch.current?.send({type:"broadcast",event:"ice",payload:e.candidate});
    ch.current.on("broadcast",{event:"offer"},async({payload}:any)=>{await conn.setRemoteDescription(payload);const a=await conn.createAnswer();await conn.setLocalDescription(a);ch.current.send({type:"broadcast",event:"answer",payload:a})});
    ch.current.on("broadcast",{event:"answer"},async({payload}:any)=>await conn.setRemoteDescription(payload));
    ch.current.on("broadcast",{event:"ice"},async({payload}:any)=>{try{await conn.addIceCandidate(payload)}catch{}});
    ch.current.subscribe(async(s:any)=>{if(s==="SUBSCRIBED"){setStatus("Waiting for the other member…");const o=await conn.createOffer();await conn.setLocalDescription(o);ch.current.send({type:"broadcast",event:"offer",payload:o})}});
   }catch(e:any){setStatus(e.message||"Camera/microphone permission failed.")}
  })();
  return()=>{active=false;pc.current?.close();if(ch.current)sb.removeChannel(ch.current)}
 },[room,video,sb]);
 return <div className="call"><div className="callhead"><b>{video?"🎥 Video call":"📞 Voice call"}</b><span>{status}</span><button onClick={onClose}>End</button></div><div className="videos"><video ref={remote} autoPlay playsInline/><video ref={local} autoPlay muted playsInline/></div><div className="room">Call room: <b>{room}</b><br/><small>For this starter, the other member must open the same room.</small></div></div>
}