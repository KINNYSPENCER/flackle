const express=require("express");
const http=require("http");
const path=require("path");
const fs=require("fs");
const bcrypt=require("bcryptjs");
const jwt=require("jsonwebtoken");
const multer=require("multer");
const {Server}=require("socket.io");

const app=express(), server=http.createServer(app), io=new Server(server);
const PORT=process.env.PORT||3000, SECRET=process.env.JWT_SECRET||"flackle-dev-secret";
const DATA=path.join(__dirname,"data"), UP=path.join(__dirname,"uploads");
fs.mkdirSync(DATA,{recursive:true}); fs.mkdirSync(UP,{recursive:true});
const DB=path.join(DATA,"db.json");
const fresh={users:[],servers:[],channels:[],messages:[],friendships:[]};
if(!fs.existsSync(DB)) fs.writeFileSync(DB,JSON.stringify(fresh,null,2));
let db=JSON.parse(fs.readFileSync(DB,"utf8"));
const save=()=>fs.writeFileSync(DB,JSON.stringify(db,null,2));

app.use(express.json({limit:"2mb"})); app.use(express.urlencoded({extended:true}));
app.use("/uploads",express.static(UP)); app.use(express.static(path.join(__dirname,"public")));

const upload=multer({dest:UP,limits:{fileSize:10*1024*1024}});
const uid=()=>Math.random().toString(36).slice(2)+Date.now().toString(36);
function token(user){return jwt.sign({id:user.id},SECRET,{expiresIn:"7d"});}
function auth(req,res,next){
  try{const p=jwt.verify((req.headers.authorization||"").replace("Bearer ",""),SECRET); req.user=db.users.find(u=>u.id===p.id); if(!req.user)return res.status(401).json({error:"Unauthorized"}); next();}
  catch(e){res.status(401).json({error:"Unauthorized"});}
}
const pubUser=u=>({id:u.id,username:u.username,avatar:u.avatar||null,status:u.status||"online",createdAt:u.createdAt});
function channelFor(id){return db.channels.find(c=>c.id===id);}
function member(server,userId){return server.members.find(m=>m.userId===userId);}
function canManage(s,u){const m=member(s,u.id); return s.ownerId===u.id || (m&&m.role==="admin");}

app.get("/api/health",(req,res)=>res.json({ok:true,name:"Flackle"}));

app.post("/api/auth/register",async(req,res)=>{
  const username=String(req.body.username||"").trim(), password=String(req.body.password||"");
  if(username.length<3||username.length>24||password.length<6)return res.status(400).json({error:"Username must be 3-24 characters and password at least 6 characters."});
  if(db.users.some(u=>u.username.toLowerCase()===username.toLowerCase()))return res.status(409).json({error:"Username already exists."});
  const user={id:uid(),username,password:await bcrypt.hash(password,10),createdAt:new Date().toISOString(),status:"online"};
  db.users.push(user); save(); res.json({token:token(user),user:pubUser(user)});
});
app.post("/api/auth/login",async(req,res)=>{
  const user=db.users.find(u=>u.username.toLowerCase()===String(req.body.username||"").toLowerCase());
  if(!user||!(await bcrypt.compare(String(req.body.password||""),user.password)))return res.status(401).json({error:"Invalid username or password."});
  user.status="online"; save(); res.json({token:token(user),user:pubUser(user)});
});
app.get("/api/me",auth,(req,res)=>res.json({user:pubUser(req.user)}));

app.get("/api/bootstrap",auth,(req,res)=>{
  const s=db.servers.filter(x=>member(x,req.user.id));
  const channels=db.channels.filter(c=>s.some(x=>x.id===c.serverId));
  res.json({servers:s,channels,users:db.users.map(pubUser),friends:db.friendships.filter(f=>f.a===req.user.id||f.b===req.user.id)});
});
app.get("/api/channels/:id/messages",auth,(req,res)=>{
  const c=channelFor(req.params.id), s=c&&db.servers.find(x=>x.id===c.serverId);
  if(!c||!s||!member(s,req.user.id))return res.status(403).json({error:"Forbidden"});
  res.json(db.messages.filter(m=>m.channelId===c.id).slice(-100).map(messageView));
});
function messageView(m){const u=db.users.find(x=>x.id===m.userId); return {...m,author:u?pubUser(u):{username:"Unknown"}};}

app.post("/api/servers",auth,(req,res)=>{
  const name=String(req.body.name||"").trim().slice(0,40); if(!name)return res.status(400).json({error:"Server name required."});
  const s={id:uid(),name,ownerId:req.user.id,icon:null,members:[{userId:req.user.id,role:"owner"}],createdAt:new Date().toISOString()};
  db.servers.push(s); const c={id:uid(),serverId:s.id,name:"general",type:"text",createdAt:new Date().toISOString()}; db.channels.push(c); save(); res.json({server:s,channel:c});
});
app.post("/api/servers/:id/channels",auth,(req,res)=>{
  const s=db.servers.find(x=>x.id===req.params.id); if(!s||!canManage(s,req.user))return res.status(403).json({error:"Admin permission required."});
  const name=String(req.body.name||"").trim().toLowerCase().replace(/[^a-z0-9-_ ]/g,"").slice(0,30); if(!name)return res.status(400).json({error:"Channel name required."});
  const c={id:uid(),serverId:s.id,name,type:"text",createdAt:new Date().toISOString()}; db.channels.push(c); save(); io.emit("channelCreated",c); res.json({channel:c});
});
app.post("/api/servers/:id/join",auth,(req,res)=>{
  const s=db.servers.find(x=>x.id===req.params.id); if(!s)return res.status(404).json({error:"Server not found."});
  if(!member(s,req.user.id))s.members.push({userId:req.user.id,role:"member"}); save(); res.json({server:s});
});
app.post("/api/servers/:id/kick",auth,(req,res)=>{
  const s=db.servers.find(x=>x.id===req.params.id); if(!s||!canManage(s,req.user))return res.status(403).json({error:"Admin permission required."});
  if(s.ownerId===req.body.userId)return res.status(400).json({error:"Owner cannot be kicked."});
  s.members=s.members.filter(m=>m.userId!==req.body.userId); save(); res.json({ok:true});
});

app.get("/api/servers/discover",auth,(req,res)=>res.json({servers:db.servers.map(s=>({...s,members:s.members.length}))}));

app.post("/api/friends",auth,(req,res)=>{
  const other=db.users.find(u=>u.username.toLowerCase()===String(req.body.username||"").toLowerCase());
  if(!other||other.id===req.user.id)return res.status(404).json({error:"User not found."});
  if(!db.friendships.some(f=>(f.a===req.user.id&&f.b===other.id)||(f.b===req.user.id&&f.a===other.id)))db.friendships.push({id:uid(),a:req.user.id,b:other.id,status:"accepted"});
  save(); res.json({user:pubUser(other)});
});
app.get("/api/dms/:userId",auth,(req,res)=>{
  const ok=db.friendships.some(f=>(f.a===req.user.id&&f.b===req.params.userId)||(f.b===req.user.id&&f.a===req.params.userId));
  if(!ok)return res.status(403).json({error:"Not friends."});
  res.json(db.messages.filter(m=>m.dmWith&&m.dmWith.includes(req.user.id)&&m.dmWith.includes(req.params.userId)).slice(-100).map(messageView));
});

app.post("/api/upload",auth,upload.single("file"),(req,res)=>{
  if(!req.file)return res.status(400).json({error:"No file."});
  res.json({url:"/uploads/"+req.file.filename,name:req.file.originalname,size:req.file.size});
});

io.use((socket,next)=>{
  try{const p=jwt.verify(socket.handshake.auth?.token||"",SECRET); socket.user=db.users.find(u=>u.id===p.id); if(!socket.user)return next(new Error("Unauthorized")); next();}
  catch(e){next(new Error("Unauthorized"));}
});
io.on("connection",socket=>{
  socket.user.status="online"; save();
  socket.on("joinChannel",id=>socket.join("channel:"+id));
  socket.on("joinDM",id=>socket.join("dm:"+[socket.user.id,id].sort().join(":")));
  socket.on("typing",data=>socket.to("channel:"+data.channelId).emit("typing",{username:socket.user.username}));
  socket.on("sendMessage",data=>{
    const text=String(data.content||"").trim().slice(0,4000); if(!text)return;
    let channel=channelFor(data.channelId);
    if(!channel)return;
    const s=db.servers.find(x=>x.id===channel.serverId); if(!s||!member(s,socket.user.id))return;
    const m={id:uid(),channelId:channel.id,userId:socket.user.id,content:text,createdAt:new Date().toISOString(),dmWith:null};
    db.messages.push(m); save(); io.to("channel:"+channel.id).emit("message",messageView(m));
  });
  socket.on("sendDM",data=>{
    const other=String(data.userId||""), text=String(data.content||"").trim().slice(0,4000);
    if(!text||!db.users.some(u=>u.id===other))return;
    const ok=db.friendships.some(f=>(f.a===socket.user.id&&f.b===other)||(f.b===socket.user.id&&f.a===other)); if(!ok)return;
    const m={id:uid(),channelId:null,userId:socket.user.id,content:text,createdAt:new Date().toISOString(),dmWith:[socket.user.id,other]};
    db.messages.push(m); save(); io.to("dm:"+[socket.user.id,other].sort().join(":")).emit("dm",messageView(m));
  });
  socket.on("disconnect",()=>{const u=db.users.find(x=>x.id===socket.user.id);if(u){u.status="offline";save();}});
});
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
server.listen(PORT,()=>console.log(`Flackle running at http://localhost:${PORT}`));
