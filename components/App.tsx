async function send(){
  if(ai){
    const q=text.trim();
    if(!q)return;
    setText("");

    try{
      const r=await fetch("/api/chat",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({message:q})
      });
      const d=await r.json();

      setMessages(x=>[...x,{
        id:Date.now(),
        sender:"GOSNAPS AI",
        text:d.reply||d.error||"AI error",
        created_at:new Date().toISOString()
      }]);
    }catch{
      setToast("AI connection failed.");
    }
    return;
  }

  if(!user){
    setToast("Sign in first.");
    return;
  }

  const messageText=text.trim();
  if(!messageText && !file){
    setToast("Type a message or choose a file.");
    return;
  }

  let attachment=null;

  if(file){
    const path=`${user.id}/${Date.now()}-${file.name}`;
    const u=await sb.storage
      .from("gosnaps-files")
      .upload(path,file);

    if(u.error){
      setToast(u.error.message);
      return;
    }

    attachment=path;
  }

  const message={
    sender_id:user.id,
    receiver_id:null,
    sender:user.email||"Member",
    content:messageText||"📎 File",
    text:messageText||"📎 File",
    file_url:attachment,
    attachment:attachment
      ? {path:attachment,name:file?.name||"File"}
      : null
  };

  const result=await sb.from("messages").insert(message);

  if(result.error){
    setToast(result.error.message);
    return;
  }

  setToast("Sent");
  setText("");
  setFile(null);
}
