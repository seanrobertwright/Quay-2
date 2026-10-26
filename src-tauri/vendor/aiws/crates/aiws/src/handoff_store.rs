//! Native opt-in SQLite journal and immutable owned-directory artifacts.
use crate::{core::{check,st},handoff::{self,HandoffState,Transition},*};
use rusqlite::{Connection,params,OptionalExtension};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::{fs::{self,File,OpenOptions},io::Write,path::PathBuf};
fn db<T>(value:rusqlite::Result<T>)->Result<T>{value.map_err(|_|error("STORAGE_ERROR"))}
pub struct HandoffStore {connection:Connection}
impl HandoffStore {
 pub fn open(path:&str,contract:Option<&Contract>,config:Option<&Value>)->Result<Self>{
  let connection=db(Connection::open(path))?;
  let legacy=db(connection.query_row("SELECT name FROM sqlite_master WHERE type='table' AND name='mission'",[],|r|r.get::<_,String>(0)).optional())?;
  check(legacy.is_none(),"UNSUPPORTED_PROTOCOL")?;
  db(connection.execute_batch("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS handoff_config(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS handoff_journal(seq INTEGER PRIMARY KEY,event TEXT NOT NULL); CREATE TABLE IF NOT EXISTS handoff_outbox(seq INTEGER PRIMARY KEY,payload TEXT NOT NULL,sent INTEGER NOT NULL DEFAULT 0)"))?;
  if let Some(c)=contract{let config=config.ok_or_else(||error("CONTRACT_REQUIRED"))?;handoff::initial(c,config)?;db(connection.execute("INSERT OR IGNORE INTO handoff_config VALUES(1,?)",[canonical(&json!({"contract":c.as_value(),"config":config}))?]))?;}
  let row=db(connection.query_row("SELECT value FROM handoff_config WHERE id=1",[],|r|r.get::<_,String>(0)).optional())?.ok_or_else(||error("CONTRACT_REQUIRED"))?;
  if let Some(c)=contract{check(row==canonical(&json!({"contract":c.as_value(),"config":config}))?,"CONTRACT_CONFLICT")?;}Ok(Self{connection})
 }
 fn load(&self)->Result<HandoffState>{
  let text:String=db(self.connection.query_row("SELECT value FROM handoff_config WHERE id=1",[],|r|r.get(0)))?;let config=parse_strict(&text)?;let mut state=handoff::initial(&Contract::from_value(config["contract"].clone())?,&config["config"])?;
  let mut statement=db(self.connection.prepare("SELECT seq,event FROM handoff_journal ORDER BY seq"))?;
  let rows=db(statement.query_map([],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?))))?;
  for row in rows{let (seq,text)=db(row)?;let event=parse_strict(&text)?;check(event["sequence"]==seq.to_string(),"JOURNAL_INTEGRITY")?;let next=handoff::transition(&state,&event["request"],st(&event["at"]),&event["facts"],true)?;check(next.event.as_ref()==Some(&event),"JOURNAL_INTEGRITY")?;state=next.state;}Ok(state)
 }
 pub fn snapshot(&self)->Result<HandoffState>{db(self.connection.execute_batch("BEGIN"))?;let result=self.load();match result{Ok(s)=>{db(self.connection.execute_batch("COMMIT"))?;Ok(s)},Err(e)=>{let _=self.connection.execute_batch("ROLLBACK");Err(e)}}}
 /// Trusted/offline write. Applications expose HandoffCoordinator instead.
 pub fn apply(&mut self,request:&Value,now:&str,facts:&Value)->Result<Transition>{self.apply_with_hook(request,now,facts,||Ok(()))}
 pub fn apply_with_hook<F:FnOnce()->Result<()>>(&mut self,request:&Value,now:&str,facts:&Value,hook:F)->Result<Transition>{
  db(self.connection.execute_batch("BEGIN IMMEDIATE"))?;
  let result=(||{let out=handoff::transition(&self.load()?,request,now,facts,false)?;if let Some(event)=&out.event{let text=canonical(event)?;parse_strict(&text)?;let seq=st(&event["sequence"]).parse::<i64>().map_err(|_|error("STORAGE_LIMIT"))?;db(self.connection.execute("INSERT INTO handoff_journal VALUES(?,?)",params![seq,text]))?;
   let payload=json!({"eventId":event["hash"],"missionId":out.state.as_value()["core"]["contract"]["missionId"],"requestId":request["requestId"],"sequence":out.state.as_value()["revision"],"at":now,"type":out.result["type"],"actorId":facts["actorId"],"policy":facts["policy"],"runId":request["runId"],"summary":handoff::report(&out.state)?});db(self.connection.execute("INSERT INTO handoff_outbox(seq,payload) VALUES(?,?)",params![seq,canonical(&payload)?]))?;}hook()?;db(self.connection.execute_batch("COMMIT"))?;Ok(out)})();if result.is_err(){let _=self.connection.execute_batch("ROLLBACK");}result
 }
 pub fn pending_events(&self,limit:u32)->Result<Vec<Value>>{check((1..=1000).contains(&limit),"SCHEMA_INVALID")?;let mut s=db(self.connection.prepare("SELECT payload FROM handoff_outbox WHERE sent=0 ORDER BY seq LIMIT ?"))?;let rows=db(s.query_map([limit],|r|r.get::<_,String>(0)))?;rows.map(|r|parse_strict(&db(r)?)).collect()}
 pub fn acknowledge_event(&mut self,sequence:&str)->Result<()>{let n=sequence.parse::<i64>().map_err(|_|error("SCHEMA_INVALID"))?;check(n>=0,"SCHEMA_INVALID")?;db(self.connection.execute("UPDATE handoff_outbox SET sent=1 WHERE seq=?",[n]))?;Ok(())}
 pub fn export_events(&self)->Result<Vec<Value>>{let mut s=db(self.connection.prepare("SELECT event FROM handoff_journal ORDER BY seq"))?;let rows=db(s.query_map([],|r|r.get::<_,String>(0)))?;rows.map(|r|parse_strict(&db(r)?)).collect()}
}
pub trait ArtifactProvider {fn read(&self,artifact:&Value)->Result<Vec<u8>>;}
/// A dedicated owned directory. `put` syncs the file, publishes it, then syncs the directory and returns `ARTIFACT_UNAVAILABLE` if that sync fails. Windows does not support syncing a directory, so there the directory entry is committed with the file's NTFS metadata and no separate directory sync is made.
pub struct FileArtifacts {root:PathBuf}
impl FileArtifacts {
 pub fn new(root:&str)->Result<Self>{let root=PathBuf::from(root);fs::create_dir_all(&root).map_err(|_|error("ARTIFACT_UNAVAILABLE"))?;Ok(Self{root:root.canonicalize().map_err(|_|error("ARTIFACT_UNAVAILABLE"))?})}
 pub fn put(&self,data:&[u8],id:&str,media_type:&str,owner:&str,retain_until:&str,schema:Option<&Value>)->Result<Value>{
  let digest=format!("{:x}",Sha256::digest(data));let path=self.root.join(&digest);
  static NEXT:std::sync::atomic::AtomicU64=std::sync::atomic::AtomicU64::new(0);
  let temp=self.root.join(format!(".upload-{}-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_|error("ARTIFACT_UNAVAILABLE"))?.as_nanos(),NEXT.fetch_add(1,std::sync::atomic::Ordering::Relaxed)));
  let mut file=OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|_|error("ARTIFACT_UNAVAILABLE"))?;
  let result=(||{file.write_all(data).and_then(|_|file.sync_all()).map_err(|_|error("ARTIFACT_UNAVAILABLE"))?;match fs::hard_link(&temp,&path){Ok(())=>Ok(()),Err(e) if e.kind()==std::io::ErrorKind::AlreadyExists=>{let meta=fs::symlink_metadata(&path).map_err(|_|error("ARTIFACT_UNAVAILABLE"))?;check(!meta.file_type().is_symlink(),"ARTIFACT_MISMATCH")?;let bytes=fs::read(&path).map_err(|_|error("ARTIFACT_UNAVAILABLE"))?;check(format!("{:x}",Sha256::digest(&bytes))==digest,"ARTIFACT_MISMATCH")},Err(_)=>Err(error("ARTIFACT_UNAVAILABLE"))}})();drop(file);let _=fs::remove_file(&temp);result?;
  if !cfg!(windows){File::open(&self.root).and_then(|f|f.sync_all()).map_err(|_|error("ARTIFACT_UNAVAILABLE"))?;}
  Ok(json!({"id":id,"locator":"sha256:".to_owned()+&digest,"version":digest,"sha256":digest,"sizeBytes":data.len().to_string(),"mediaType":media_type,"schema":schema,"retentionOwner":owner,"retainUntilMs":retain_until}))
 }
}
impl ArtifactProvider for FileArtifacts {
 fn read(&self,a:&Value)->Result<Vec<u8>>{let hash=st(&a["sha256"]);check(hash.len()==64&&hash.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))&&a["locator"]=="sha256:".to_owned()+hash&&a["version"]==hash,"ARTIFACT_MISMATCH")?;let path=self.root.join(hash);let metadata=fs::symlink_metadata(&path).map_err(|_|error("ARTIFACT_UNAVAILABLE"))?;check(!metadata.file_type().is_symlink(),"ARTIFACT_MISMATCH")?;let data=fs::read(path).map_err(|_|error("ARTIFACT_UNAVAILABLE"))?;check(format!("{:x}",Sha256::digest(&data))==hash&&a["sizeBytes"]==data.len().to_string(),"ARTIFACT_MISMATCH")?;Ok(data)}
}
pub trait HandoffAuthorizer {fn authorize(&self,request:&Value,state:&HandoffState,now:&str)->Result<Value>;}
impl<F:Fn(&Value,&HandoffState,&str)->Result<Value>> HandoffAuthorizer for F{fn authorize(&self,r:&Value,s:&HandoffState,n:&str)->Result<Value>{self(r,s,n)}}
pub struct HandoffCoordinator<A:HandoffAuthorizer,C:Fn()->String,P:ArtifactProvider>{pub store:HandoffStore,authorize:A,clock:C,artifacts:P,verified:Vec<(Value,Vec<u8>)>}
impl<A:HandoffAuthorizer,C:Fn()->String,P:ArtifactProvider> HandoffCoordinator<A,C,P>{
 pub fn new(store:HandoffStore,authorize:A,clock:C,artifacts:P)->Self{Self{store,authorize,clock,artifacts,verified:vec![]}}
 fn checked_apply(&mut self,request:&Value)->Result<(Transition,String)>{
  self.verified.clear();handoff::validate_runtime("Request",request)?;if request["command"].get("protocol").is_some(){handoff::checked("Command",&request["command"])?;}
  let snapshot=self.store.snapshot()?;let now=(self.clock)();let mut facts=self.authorize.authorize(request,&snapshot,&now)?;check(facts["allowed"]==true,"AUTHORIZATION_DENIED")?;facts["materials"]=json!({});facts["materialErrors"]=json!({});facts["authorizedAtMs"]=json!(now);handoff::validate_runtime("Facts",&facts)?;
  let mut manifests:Vec<Value>=snapshot.as_value()["manifests"].as_object().unwrap().values().cloned().collect();let body=&request["command"]["body"];if body["type"]=="commitBoundary"{manifests.push(body["manifest"].clone());}let kind=body.get("type").unwrap_or(&request["command"]["type"]);let mut needed=vec![];
  if ["commitBoundary","acknowledgeDelivery","admitConsumer","dispatch","retry","resolveHold"].contains(&st(kind)){for m in &manifests{for a in m["artifacts"].as_array().unwrap(){let result:Result<Vec<u8>>=(||{check(crate::core::q(&json!(now))<crate::core::q(&a["retainUntilMs"]),"ARTIFACT_UNAVAILABLE")?;let data=self.artifacts.read(a)?;check(format!("{:x}",Sha256::digest(&data))==a["sha256"].as_str().unwrap_or("")&&a["sizeBytes"]==data.len().to_string(),"ARTIFACT_MISMATCH")?;
    if !a["schema"].is_null(){let schema=&a["schema"];let sa=manifests.iter().flat_map(|m|m["artifacts"].as_array().unwrap()).find(|v|v["id"]==schema["id"]&&v["sha256"]==schema["digest"]).ok_or_else(||error("ARTIFACT_UNAVAILABLE"))?;let schema_bytes=self.artifacts.read(sa)?;check(format!("{:x}",Sha256::digest(&schema_bytes))==sa["sha256"].as_str().unwrap_or("")&&sa["sizeBytes"]==schema_bytes.len().to_string(),"ARTIFACT_MISMATCH")?;validate_data(&parse_strict(std::str::from_utf8(&schema_bytes).map_err(|_|error("DATA_SCHEMA"))?)?,&parse_strict(std::str::from_utf8(&data).map_err(|_|error("DATA_SCHEMA"))?)?)?;}Ok(data)})();
    match result{Ok(data)=>{facts["materials"][st(&a["id"])]=json!(handoff::sha(a)?);needed.push((a.clone(),data));},Err(e)=>{if !["ARTIFACT_UNAVAILABLE","ARTIFACT_MISMATCH","DATA_SCHEMA"].contains(&e.code.as_str()){return Err(e);}facts["materialErrors"][handoff::sha(a)?]=json!(e.code);}}
  }}}
  let actor=st(&facts["actorId"]).to_owned();let response=self.store.apply(request,&(self.clock)(),&facts)?;if response.event.is_some(){self.verified=needed;}Ok((response,actor))
 }
 pub fn apply(&mut self,request:&Value)->Result<Transition>{Ok(self.checked_apply(request)?.0)}
 pub fn claim(&mut self,request:&Value)->Result<(Transition,String)>{let (response,actor)=self.checked_apply(request)?;check(response.result["type"]=="claimDelivery","SCHEMA_INVALID")?;let key=canonical(&json!([actor,request["requestId"]]))?;let token=handoff::sha(&json!([key,response.result["deliveryId"],response.result["generation"],response.result["ownerEpoch"]]))?;Ok((response,token))}
 pub fn verified_material(&self)->Vec<(Value,Vec<u8>)>{self.verified.clone()}
}
