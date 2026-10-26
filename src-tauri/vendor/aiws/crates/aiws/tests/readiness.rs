use aiws_sdk::canonical;
use aiws_sdk::readiness::*;
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
const HEADERED:[&str;5]=["Manifest","Requirements","Snapshot","Binding","Report"];
fn v2()->Value{serde_json::from_str(include_str!("../../../spec/engine-v1/readiness.fixtures.json")).unwrap()}
fn v1()->Value{serde_json::from_str(include_str!("../../../spec/engine-v1/readiness.fixtures-1.0.0.json")).unwrap()}
fn cases(f:&Value)->Vec<Value>{f["cases"].as_array().unwrap().clone()}
fn raw(c:&Value)->Value{serde_json::from_str(c["raw"].as_str().unwrap()).unwrap()}
fn first(f:&Value,kind:&str)->Value{raw(cases(f).iter().find(|c|c["valid"]==true&&c["kind"]==kind).unwrap())}
fn canon(v:&Value)->String{canonical(v).unwrap()}
fn refused<T:std::fmt::Debug>(r:Result<T,String>,code:&str,name:&str){assert_eq!(r.unwrap_err(),code,"{name}")}
fn with(v:&Value,field:&str,value:Value)->Value{let mut copy=v.clone();copy[field]=value;copy}

#[test]fn the_sdk_carries_2_0_0_as_its_current_schema_and_1_0_0_frozen_beside_it(){
 assert_eq!(include_str!("../src/readiness.schema.json").replace("\r\n","\n"),include_str!("../../../spec/engine-v1/readiness.schema.json").replace("\r\n","\n"));
 assert_eq!(include_str!("../src/readiness.schema-1.0.0.json").replace("\r\n","\n"),include_str!("../../../spec/engine-v1/readiness.schema-1.0.0.json").replace("\r\n","\n"));
}

#[test]fn every_valid_2_0_0_fixture_round_trips_through_the_codec(){
 for c in cases(&v2()).iter().filter(|c|c["valid"]==true){
  let (kind,name)=(c["kind"].as_str().unwrap(),c["name"].as_str().unwrap());
  let decoded=decode_readiness(c["raw"].as_str().unwrap(),kind).unwrap();let text=encode_readiness(&decoded,kind).unwrap();
  assert_eq!(text,canon(&raw(c)),"{name}");
  assert_eq!(decode_readiness(&text,kind).unwrap(),decoded,"{name}");
  assert_eq!(encode_readiness(&decode_readiness(&text,kind).unwrap(),kind).unwrap(),text,"{name}");
 }
}

#[test]fn every_invalid_2_0_0_fixture_is_refused_with_its_recorded_error(){
 for c in cases(&v2()).iter().filter(|c|c["valid"]==false){refused(decode_readiness(c["raw"].as_str().unwrap(),c["kind"].as_str().unwrap()),c["error"].as_str().unwrap_or("INVALID_READINESS_MESSAGE"),c["name"].as_str().unwrap())}
}

// The generated types describe 2.0.0 and v1 the frozen 1.0.0: each valid record reads into the type
// of its version and writes back the same canonical text.
fn typed<T:serde::de::DeserializeOwned+serde::Serialize>(c:&Value){let name=c["name"].as_str().unwrap();let value:T=serde_json::from_str(c["raw"].as_str().unwrap()).unwrap_or_else(|e|panic!("{name}: {e}"));assert_eq!(canon(&serde_json::to_value(&value).unwrap()),canon(&raw(c)),"{name}")}
fn typed_case(c:&Value,legacy:bool){
 match (c["kind"].as_str().unwrap(),legacy){
 ("Manifest",false)=>typed::<Manifest>(c),("Requirements",false)=>typed::<Requirements>(c),("Snapshot",false)=>typed::<Snapshot>(c),("Binding",false)=>typed::<Binding>(c),("Report",false)=>typed::<Report>(c),
 ("Capability",false)=>typed::<Capability>(c),("Requirement",false)=>typed::<Requirement>(c),("Evidence",false)=>typed::<Evidence>(c),("Check",false)=>typed::<Check>(c),
 ("Manifest",true)=>typed::<v1::Manifest>(c),("Requirements",true)=>typed::<v1::Requirements>(c),("Snapshot",true)=>typed::<v1::Snapshot>(c),("Binding",true)=>typed::<v1::Binding>(c),("Report",true)=>typed::<v1::Report>(c),
 (kind,_)=>panic!("unexpected kind {kind}")}
}
#[test]fn the_generated_types_read_every_valid_record_of_their_version(){
 for c in cases(&v2()).iter().filter(|c|c["valid"]==true){typed_case(c,false)}
 // A headerless 1.0.0 part decodes under 2.0.0, so only the headered records need the v1 types.
 for c in cases(&v1()).iter().filter(|c|c["valid"]==true){typed_case(c,HEADERED.contains(&c["kind"].as_str().unwrap()))}
}

#[test]fn every_1_0_0_fixture_still_decodes_as_recorded(){
 for c in cases(&v1()){
  let (kind,name)=(c["kind"].as_str().unwrap(),c["name"].as_str().unwrap());let decoded=decode_readiness(c["raw"].as_str().unwrap(),kind);
  if c["valid"]==true{assert_eq!(canon(&decoded.unwrap()),canon(&raw(&c)),"{name}")}else{assert!(decoded.is_err(),"{name}")}
 }
 // A lone surrogate is refused with the code the TypeScript and Python SDKs give it.
 refused(decode_readiness(r#"{"agentId":"\ud800"}"#,"Manifest"),"INVALID_UNICODE","leading surrogate");
 refused(decode_readiness(r#"{"agentId":"\udc00"}"#,"Manifest"),"INVALID_UNICODE","trailing surrogate");
 refused(decode_readiness(r#"{"agentId":"\ud800A"}"#,"Manifest"),"INVALID_UNICODE","leading surrogate before a non-surrogate");
 for text in [r#"{"agentId":"\u00"}"#,r#"{"agentId":"\u00zz"}"#,r#"{"agentId":"\u"#]{refused(decode_readiness(text,"Manifest"),"INVALID_JSON",text)}
}

#[test]fn the_1_0_0_semantic_scenarios_still_evaluate_as_recorded(){
 for c in v1()["scenarios"].as_array().unwrap(){
  let r=evaluate_readiness(&c["snapshot"],&c["requirements"],c["nowMs"].as_u64().unwrap(),c["expectedManifestDigest"].as_str()).unwrap();
  let statuses:Vec<Value>=r["checks"].as_array().unwrap().iter().map(|x|x["status"].clone()).collect();
  assert_eq!(json!({"status":r["status"],"checkStatuses":statuses,"agentMatches":r["agentMatches"],"pinMatches":r["pinMatches"],"fresh":r["fresh"]}),c["expected"],"{}",c["name"]);
  assert_eq!(r["version"],"1.0.0");assert_eq!(r["profile"],"aiws-readiness/1");
 }
}

#[test]fn encoding_always_produces_2_0_0_and_a_1_0_0_record_is_read_only(){
 for c in cases(&v1()).iter().filter(|c|c["valid"]==true&&HEADERED.contains(&c["kind"].as_str().unwrap())){
  let kind=c["kind"].as_str().unwrap();refused(encode_readiness(&decode_readiness(c["raw"].as_str().unwrap(),kind).unwrap(),kind),"UNSUPPORTED_VERSION",c["name"].as_str().unwrap());
 }
 for c in cases(&v2()).iter().filter(|c|c["valid"]==true&&HEADERED.contains(&c["kind"].as_str().unwrap())){
  let out:Value=serde_json::from_str(&encode_readiness(&raw(c),c["kind"].as_str().unwrap()).unwrap()).unwrap();
  assert_eq!(out["version"],"2.0.0","{}",c["name"]);assert!(out["profile"].as_str().unwrap().ends_with("/2"),"{}",c["name"]);
 }
}

#[test]fn a_record_nests_only_records_of_its_own_version(){
 let (f1,f2)=(v1(),v2());
 refused(decode_readiness(&canon(&with(&first(&f2,"Binding"),"requirements",first(&f1,"Requirements"))),"Binding"),"INVALID_READINESS_MESSAGE","2.0.0 binding of 1.0.0 requirements");
 refused(decode_readiness(&canon(&with(&first(&f2,"Snapshot"),"manifest",first(&f1,"Manifest"))),"Snapshot"),"INVALID_READINESS_MESSAGE","2.0.0 snapshot of a 1.0.0 manifest");
 refused(decode_readiness(&canon(&with(&first(&f1,"Binding"),"requirements",first(&f2,"Requirements"))),"Binding"),"INVALID_READINESS_MESSAGE","1.0.0 binding of 2.0.0 requirements");
 refused(decode_readiness(&canon(&with(&first(&f1,"Snapshot"),"manifest",first(&f2,"Manifest"))),"Snapshot"),"INVALID_READINESS_MESSAGE","1.0.0 snapshot of a 2.0.0 manifest");
}

#[test]fn the_2_0_0_records_keep_the_codec_rules_beyond_the_schema(){
 let f=v2();let (manifest,requirements,snapshot)=(first(&f,"Manifest"),first(&f,"Requirements"),first(&f,"Snapshot"));
 let twice=|v:&Value,field:&str|with(v,field,json!([v[field][0],v[field][0]]));
 refused(encode_readiness(&twice(&manifest,"capabilities"),"Manifest"),"DUPLICATE_CAPABILITY","manifest");
 refused(encode_readiness(&twice(&requirements,"capabilities"),"Requirements"),"DUPLICATE_CAPABILITY","requirements");
 refused(encode_readiness(&twice(&snapshot,"evidence"),"Snapshot"),"DUPLICATE_CAPABILITY","evidence");
 refused(encode_readiness(&with(&snapshot,"evidence",json!([with(&snapshot["evidence"][0],"name",json!("undeclared"))])),"Snapshot"),"UNKNOWN_EVIDENCE","evidence");
 refused(encode_readiness(&with(&snapshot,"validUntilMs",snapshot["observedAtMs"].clone()),"Snapshot"),"INVALID_VALIDITY","snapshot");
 assert!(decode_readiness(&canon(&manifest).replace(r#""version":"2.0.0""#,r#""version":"2.0.0","version":"2.0.0""#),"Manifest").is_err());
}

#[test]fn only_the_nine_readiness_records_are_kinds(){
 for kind in ["ModelSetEntry","ModelConfiguration","Str","constructor","toString"]{refused(decode_readiness("{}",kind),"INVALID_KIND",kind)}
}

#[test]fn manifest_digests_cover_both_versions(){
 for f in [v1(),v2()]{for c in cases(&f).iter().filter(|c|c["valid"]==true&&c["kind"]=="Manifest"){
  assert_eq!(manifest_digest(&raw(c)).unwrap(),format!("{:x}",Sha256::digest(canon(&raw(c)).as_bytes())),"{}",c["name"]);
 }}
}

#[test]fn evaluation_is_1_0_0_only_until_2_0_0_semantics_are_specified_for_the_sdks(){
 let (f1,f2)=(v1(),v2());let legacy=&f1["scenarios"][0];
 refused(evaluate_readiness(&first(&f2,"Snapshot"),&first(&f2,"Requirements"),2000,None),"UNSUPPORTED_VERSION","2.0.0 inputs");
 refused(evaluate_readiness(&first(&f2,"Snapshot"),&legacy["requirements"],2000,None),"UNSUPPORTED_VERSION","2.0.0 snapshot");
 refused(evaluate_readiness(&legacy["snapshot"],&first(&f2,"Requirements"),150,None),"UNSUPPORTED_VERSION","2.0.0 requirements");
}
