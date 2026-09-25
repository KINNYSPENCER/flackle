const express=require("express");
const http=require("http");
const path=require("path");
const fs=require("fs");
const bcrypt=require("bcryptjs");
const jwt=require("jsonwebtoken");
const multer=require("multer");
const {Server}=require("socket.io");

const app=express(),server=http.createServer(app),io=new Server(server);
const PORT=process.env.PORT||3000,SECRET=process.env.JWT_SECRET||"flackle-dev-secret";
const DATA=path.join(__dirname,"data"),UP=path.join(__dirname,"uploads");
fs.mkdirSync(DATA,{recursive:true});fs.mkdirSync(UP,{recursive:true});
const DB=path.join(DATA,"db.json");
const fresh={users:[],servers:[],channels:[],messages:[],friendships:[],notifications:[],reports:[]};
if(!fs.existsSync(DB))fs.writeFileSync(DB,JSON.stringify(fresh,null,2));
let db=JSON.parse(fs.readFileSync(DB,"utf8"));
for(const key of Object.keys(fresh))if(!Array.isArray(db[key]))db[key]=[];
const save=()=>fs.writeFileSync(DB,JSON.stringify(db,null,2));

app.use(express.json({limit:"2mb"}));app.use(express.urlencoded({extended:true}));
app.use("/uploads",express.static(UP));app.use(express.static(path.join(__dirname,"public")));
const upload=multer({dest:UP,limits:{fileSize:10*1024*1024}});
const uid=()=>Math.random().toString(36).slice(2)+Date.now().toString(36);
const now=()=>new Date().toISOString();
function token(user){return jwt.sign({id:user.id},SECRET,{expiresIn:"7d"});}
function isStaff(user){return user?.globalRole==="staff"||db.users[0]?.id===user?.id;}
function auth(req,res,next){
 try{const p=jwt.verify((req.headers.authorization||"").replace("Bearer ",""),SECRET);req.user=db.users.find(u=>u.id===p.id);if(!req.user||req.user.banned)return res.status(401).json({error:req.user?.banned?"This account has been banned.":"Unauthorized"});next();}
 catch(e){res.status(401).json({error:"Unauthorized"});}
}
function staffOnly(req,res,next){if(!isStaff(req.user))return res.status(403).json({error:"Staff access required."});next();}
const pubUser=u=>({id:u.id,username:u.username,avatar:u.avatar||null,status:u.status||"offline",createdAt:u.createdAt,bio:u.bio||"",globalRole:isStaff(u)?"staff":"member",banned:!!u.banned});
const channelFor=id=>db.channels.find(c=>c.id===id);
const member=(server,userId)=>server.members.find(m=>m.userId===userId);
const canManage=(server,user)=>server.ownerId===user.id||member(server,user.id)?.role==="admin";
function messageView(message){const user=db.users.find(x=>x.id===message.userId);return {...message,author:user?pubUser(user):{username:"Unknown"}};}
function addNotification(userId,type,text,details={}){const n={id:uid(),userId,type,text,read:false,createdAt:now(),...details};db.notifications.push(n);io.to("user:"+userId).emit("notification",n);return n;}

app.get("/api/health",(req,res)=>res.json({ok:true,name:"Flackle"}));
app.post("/api/auth/register",async(req,res)=>{
 const username=String(req.body.username||"").trim(),password=String(req.body.password||"");
 if(username.length<3||username.length>24||password.length<6)return res.status(400).json({error:"Username must be 3-24 characters and password at least 6 characters."});
 if(db.users.some(u=>u.username.toLowerCase()===username.toLowerCase()))return res.status(409).json({error:"Username already exists."});
 const user={id:uid(),username,password:await bcrypt.hash(password,10),createdAt:now(),status:"online",bio:"",globalRole:db.users.length?"member":"staff",banned:false};
 db.users.push(user);save();res.json({token:token(user),user:pubUser(user)});
});
app.post("/api/auth/login",async(req,res)=>{
 const user=db.users.find(u=>u.username.toLowerCase()===String(req.body.username||"").toLowerCase());
 if(!user||!(await bcrypt.compare(String(req.body.password||""),user.password)))return res.status(401).json({error:"Invalid username or password."});
 if(user.banned)return res.status(403).json({error:"This account has been banned."});
 user.status="online";save();res.json({token:token(user),user:pubUser(user)});
});
app.get("/api/me",auth,(req,res)=>res.json({user:pubUser(req.user)}));
app.patch("/api/me",auth,(req,res)=>{req.user.bio=String(req.body.bio||"").trim().slice(0,190);save();res.json({user:pubUser(req.user)});});
app.get("/api/users/:id",auth,(req,res)=>{const user=db.users.find(u=>u.id===req.params.id);if(!user)return res.status(404).json({error:"User not found."});res.json({user:pubUser(user),mutualServers:db.servers.filter(s=>member(s,req.user.id)&&member(s,user.id)).map(s=>({id:s.id,name:s.name}))});});

app.get("/api/bootstrap",auth,(req,res)=>{
 const servers=db.servers.filter(x=>member(x,req.user.id));
 const channels=db.channels.filter(c=>servers.some(x=>x.id===c.serverId));
 res.json({servers,channels,users:db.users.filter(u=>!u.banned).map(pubUser),friends:db.friendships.filter(f=>f.a===req.user.id||f.b===req.user.id),notifications:db.notifications.filter(n=>n.userId===req.user.id).slice(-50).reverse(),isStaff:isStaff(req.user)});
});
app.get("/api/recent",auth,(req,res)=>{
 const latest=new Map();
 for(const m of db.messages){if(!m.dmWith?.includes(req.user.id))continue;const otherId=m.dmWith.find(id=>id!==req.user.id);if(!otherId)continue;const old=latest.get(otherId);if(!old||old.createdAt<m.createdAt)latest.set(otherId,m);}
 const conversations=[...latest.entries()].map(([userId,m])=>({user:pubUser(db.users.find(u=>u.id===userId)),message:messageView(m)})).filter(x=>x.user&&!x.user.banned).sort((a,b)=>b.message.createdAt.localeCompare(a.message.createdAt));
 res.json({conversations});
});
app.get("/api/notifications",auth,(req,res)=>res.json({notifications:db.notifications.filter(n=>n.userId===req.user.id).slice(-50).reverse()}));
app.post("/api/notifications/read",auth,(req,res)=>{db.notifications.filter(n=>n.userId===req.user.id).forEach(n=>n.read=true);save();res.json({ok:true});});

app.get("/api/channels/:id/messages",auth,(req,res)=>{const c=channelFor(req.params.id),s=c&&db.servers.find(x=>x.id===c.serverId);if(!c||!s||!member(s,req.user.id))return res.status(403).json({error:"Forbidden"});res.json(db.messages.filter(m=>m.channelId===c.id).slice(-100).map(messageView));});
app.post("/api/servers",auth,(req,res)=>{const name=String(req.body.name||"").trim().slice(0,40);if(!name)return res.status(400).json({error:"Server name required."});const s={id:uid(),name,description:"",ownerId:req.user.id,icon:null,members:[{userId:req.user.id,role:"owner"}],createdAt:now()};db.servers.push(s);const c={id:uid(),serverId:s.id,name:"general",type:"text",createdAt:now()};db.channels.push(c);save();res.json({server:s,channel:c});});
app.patch("/api/servers/:id",auth,(req,res)=>{const s=db.servers.find(x=>x.id===req.params.id);if(!s||!canManage(s,req.user))return res.status(403).json({error:"Admin permission required."});const name=String(req.body.name||"").trim().slice(0,40);if(!name)return res.status(400).json({error:"Server name required."});s.name=name;s.description=String(req.body.description||"").trim().slice(0,240);save();io.emit("serverUpdated",s);res.json({server:s});});
app.post("/api/servers/:id/channels",auth,(req,res)=>{const s=db.servers.find(x=>x.id===req.params.id);if(!s||!canManage(s,req.user))return res.status(403).json({error:"Admin permission required."});const name=String(req.body.name||"").trim().toLowerCase().replace(/[^a-z0-9-_ ]/g,"").slice(0,30);if(!name)return res.status(400).json({error:"Channel name required."});const c={id:uid(),serverId:s.id,name,type:"text",createdAt:now()};db.channels.push(c);save();io.emit("channelCreated",c);res.json({channel:c});});
app.post("/api/servers/:id/join",auth,(req,res)=>{const s=db.servers.find(x=>x.id===req.params.id);if(!s)return res.status(404).json({error:"Server not found."});if(!member(s,req.user.id))s.members.push({userId:req.user.id,role:"member"});save();res.json({server:s});});
app.post("/api/servers/:id/kick",auth,(req,res)=>{const s=db.servers.find(x=>x.id===req.params.id);if(!s||!canManage(s,req.user))return res.status(403).json({error:"Admin permission required."});if(s.ownerId===req.body.userId)return res.status(400).json({error:"Owner cannot be kicked."});s.members=s.members.filter(m=>m.userId!==req.body.userId);save();res.json({ok:true});});
app.get("/api/servers/discover",auth,(req,res)=>res.json({servers:db.servers.map(s=>({...s,members:s.members.length}))}));

app.post("/api/friends",auth,(req,res)=>{const other=db.users.find(u=>u.username.toLowerCase()===String(req.body.username||"").toLowerCase()&&!u.banned);if(!other||other.id===req.user.id)return res.status(404).json({error:"User not found."});if(!db.friendships.some(f=>(f.a===req.user.id&&f.b===other.id)||(f.b===req.user.id&&f.a===other.id)))db.friendships.push({id:uid(),a:req.user.id,b:other.id,status:"accepted"});save();res.json({user:pubUser(other)});});
app.get("/api/dms/:userId",auth,(req,res)=>{const ok=db.friendships.some(f=>(f.a===req.user.id&&f.b===req.params.userId)||(f.b===req.user.id&&f.a===req.params.userId));if(!ok)return res.status(403).json({error:"Not friends."});res.json(db.messages.filter(m=>m.dmWith?.includes(req.user.id)&&m.dmWith.includes(req.params.userId)).slice(-100).map(messageView));});
app.post("/api/messages/:id/report",auth,(req,res)=>{const message=db.messages.find(m=>m.id===req.params.id);if(!message)return res.status(404).json({error:"Message not found."});const channel=message.channelId&&channelFor(message.channelId),server=channel&&db.servers.find(s=>s.id===channel.serverId);const canView=message.dmWith?.includes(req.user.id)||(server&&member(server,req.user.id));if(!canView)return res.status(403).json({error:"Forbidden"});if(message.userId===req.user.id)return res.status(400).json({error:"You cannot report your own message."});if(db.reports.some(r=>r.messageId===message.id&&r.reporterId===req.user.id&&r.status==="open"))return res.status(409).json({error:"You already reported this message."});const report={id:uid(),messageId:message.id,reporterId:req.user.id,reportedUserId:message.userId,reason:String(req.body.reason||"Inappropriate message").trim().slice(0,300),status:"open",createdAt:now()};db.reports.push(report);save();res.json({report});});

app.get("/api/staff/reports",auth,staffOnly,(req,res)=>res.json({reports:db.reports.slice().reverse().map(r=>({...r,message:db.messages.find(m=>m.id===r.messageId),reporter:pubUser(db.users.find(u=>u.id===r.reporterId)),reportedUser:pubUser(db.users.find(u=>u.id===r.reportedUserId))}))}));
app.post("/api/staff/reports/:id/resolve",auth,staffOnly,(req,res)=>{const report=db.reports.find(r=>r.id===req.params.id);if(!report)return res.status(404).json({error:"Report not found."});report.status="resolved";report.resolvedAt=now();report.resolvedBy=req.user.id;save();res.json({ok:true});});
app.post("/api/staff/users/:id/ban",auth,staffOnly,(req,res)=>{const user=db.users.find(u=>u.id===req.params.id);if(!user)return res.status(404).json({error:"User not found."});if(user.id===req.user.id||isStaff(user))return res.status(400).json({error:"Staff accounts cannot be banned."});user.banned=true;user.status="offline";user.banReason=String(req.body.reason||"Community guidelines violation").trim().slice(0,300);user.bannedAt=now();save();io.to("user:"+user.id).emit("banned",{reason:user.banReason});res.json({ok:true});});
app.post("/api/upload",auth,upload.single("file"),(req,res)=>{if(!req.file)return res.status(400).json({error:"No file."});res.json({url:"/uploads/"+req.file.filename,name:req.file.originalname,size:req.file.size});});

io.use((socket,next)=>{try{const p=jwt.verify(socket.handshake.auth?.token||"",SECRET);socket.user=db.users.find(u=>u.id===p.id);if(!socket.user||socket.user.banned)return next(new Error("Unauthorized"));next();}catch(e){next(new Error("Unauthorized"));}});
io.on("connection",socket=>{
 socket.user.status="online";socket.join("user:"+socket.user.id);save();
 socket.on("joinChannel",id=>socket.join("channel:"+id));socket.on("joinDM",id=>socket.join("dm:"+[socket.user.id,id].sort().join(":")));
 socket.on("typing",data=>socket.to("channel:"+data.channelId).emit("typing",{username:socket.user.username}));
 socket.on("sendMessage",data=>{const text=String(data.content||"").trim().slice(0,4000),channel=channelFor(data.channelId);if(!text||!channel)return;const s=db.servers.find(x=>x.id===channel.serverId);if(!s||!member(s,socket.user.id))return;const m={id:uid(),channelId:channel.id,userId:socket.user.id,content:text,createdAt:now(),dmWith:null};db.messages.push(m);const mentioned=new Set();for(const u of db.users){if(u.id!==socket.user.id&&text.toLowerCase().includes("@"+u.username.toLowerCase())&&member(s,u.id)&&!mentioned.has(u.id)){mentioned.add(u.id);addNotification(u.id,"mention",`${socket.user.username} mentioned you in #${channel.name}`,{messageId:m.id,channelId:channel.id,serverId:s.id});}}save();io.to("channel:"+channel.id).emit("message",messageView(m));});
 socket.on("sendDM",data=>{const other=String(data.userId||""),text=String(data.content||"").trim().slice(0,4000);if(!text||!db.users.some(u=>u.id===other&&!u.banned))return;const ok=db.friendships.some(f=>(f.a===socket.user.id&&f.b===other)||(f.b===socket.user.id&&f.a===other));if(!ok)return;const m={id:uid(),channelId:null,userId:socket.user.id,content:text,createdAt:now(),dmWith:[socket.user.id,other]};db.messages.push(m);addNotification(other,"dm",`${socket.user.username} sent you a message`,{messageId:m.id,fromUserId:socket.user.id});save();io.to("dm:"+[socket.user.id,other].sort().join(":")).emit("dm",messageView(m));});
 socket.on("disconnect",()=>{const u=db.users.find(x=>x.id===socket.user.id);if(u){u.status="offline";save();}});
});
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
server.listen(PORT,()=>console.log(`Flackle running at http://localhost:${PORT}`));
