//! One durable transaction boundary for all nested scope reservations.
use crate::{limits::{self,Transition},core::{check,st},*};
use rusqlite::{Connection,params,OptionalExtension};
use serde_json::Value;
fn db<T>(value:rusqlite::Result<T>)->Result<T>{value.map_err(|_|error("STORAGE_ERROR"))}
pub struct LimitStore{connection:Connection}
impl LimitStore{
 pub fn open(path:&str,config:Option<&Value>)->Result<Self>{
  let connection=db(Connection::open(path))?;
  let legacy=db(connection.query_row("SELECT name FROM sqlite_master WHERE name IN ('mission','handoff_config')",[],|r|r.get::<_,String>(0)).optional())?;check(legacy.is_none(),"UNSUPPORTED_PROTOCOL")?;
  db(connection.execute_batch("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS limits_config(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS limits_journal(seq INTEGER PRIMARY KEY,event TEXT NOT NULL)"))?;
  if let Some(c)=config{limits::initial(c)?;db(connection.execute("INSERT OR IGNORE INTO limits_config VALUES(1,?)",[canonical(c)?]))?;}
  let row=db(connection.query_row("SELECT value FROM limits_config WHERE id=1",[],|r|r.get::<_,String>(0)).optional())?.ok_or_else(||error("CONTRACT_REQUIRED"))?;
  if let Some(c)=config{check(row==canonical(c)?,"CONTRACT_CONFLICT")?;}Ok(Self{connection})
 }
 fn load(&self)->Result<Value>{
  let text:String=db(self.connection.query_row("SELECT value FROM limits_config WHERE id=1",[],|r|r.get(0)))?;let mut state=limits::initial(&parse_strict(&text)?)?;
  let mut statement=db(self.connection.prepare("SELECT seq,event FROM limits_journal ORDER BY seq"))?;let rows=db(statement.query_map([],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?))))?;
  for row in rows{let(seq,text)=db(row)?;let event=parse_strict(&text)?;check(event["sequence"]==seq.to_string(),"JOURNAL_INTEGRITY")?;let next=limits::transition(&state,&event["request"],st(&event["at"]),&event["facts"])?;check(next.event.as_ref()==Some(&event),"JOURNAL_INTEGRITY")?;state=next.state;}Ok(state)
 }
 pub fn snapshot(&self)->Result<Value>{db(self.connection.execute_batch("BEGIN"))?;let result=self.load();match result{Ok(s)=>{db(self.connection.execute_batch("COMMIT"))?;Ok(s)},Err(e)=>{let _=self.connection.execute_batch("ROLLBACK");Err(e)}}}
 /// Trusted/offline boundary. Application clients use LimitCoordinator.
 pub fn apply(&mut self,request:&Value,now:&str,facts:&Value)->Result<Transition>{self.apply_with_hook(request,now,facts,||Ok(()))}
 pub fn apply_with_hook<F:FnOnce()->Result<()>>(&mut self,request:&Value,now:&str,facts:&Value,hook:F)->Result<Transition>{
  db(self.connection.execute_batch("BEGIN IMMEDIATE"))?;let result=(||{let out=limits::transition(&self.load()?,request,now,facts)?;if let Some(event)=&out.event{let text=canonical(event)?;parse_strict(&text)?;let seq=st(&event["sequence"]).parse::<i64>().map_err(|_|error("STORAGE_LIMIT"))?;db(self.connection.execute("INSERT INTO limits_journal VALUES(?,?)",params![seq,text]))?;}hook()?;Ok(out)})();
  match result{Ok(out)=>{db(self.connection.execute_batch("COMMIT"))?;Ok(out)},Err(e)=>{let _=self.connection.execute_batch("ROLLBACK");Err(e)}}
 }
 pub fn export_events(&self)->Result<Vec<Value>>{let mut statement=db(self.connection.prepare("SELECT event FROM limits_journal ORDER BY seq"))?;let rows=db(statement.query_map([],|r|r.get::<_,String>(0)))?;rows.map(|r|parse_strict(&db(r)?)).collect()}
 pub fn report(&self,now:&str)->Result<Value>{limits::report(&self.snapshot()?,now)}
}
pub trait LimitAuthorizer{fn authorize(&mut self,request:&Value,state:&Value,now:&str)->Result<Value>;}
pub struct LimitCoordinator<A,C>{pub store:LimitStore,pub authorize:A,pub clock:C}
impl<A:LimitAuthorizer,C:FnMut()->String> LimitCoordinator<A,C>{
 pub fn apply(&mut self,request:&Value)->Result<Transition>{limits::checked("Request",request)?;let s=self.store.snapshot()?;let now=(self.clock)();let mut facts=self.authorize.authorize(request,&s,&now)?;let now=(self.clock)();facts["authorizedAtMs"]=Value::String(now.clone());self.store.apply(request,&now,&facts)}
}
