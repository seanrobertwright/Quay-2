use aiws_sdk::{Contract,Result,handoff::{activation,report,sha,HandoffState},handoff_store::{HandoffStore,HandoffCoordinator,FileArtifacts}};
use serde_json::{Value,json};
use std::{collections::BTreeMap,time::{SystemTime,UNIX_EPOCH}};
fn main()->Result<()> {
    // Local control simulation: template settle outcomes do not perform real effects.
    let corpus:Value=serde_json::from_str(&std::fs::read_to_string("spec/handoff-v1/runtime-cases.json").unwrap()).unwrap();
    let demo=&corpus["cases"][0];let contract=Contract::parse(&demo["contract"].to_string())?;
    let root=std::env::temp_dir().join(format!("aiws-handoff-example-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
    std::fs::create_dir(&root).unwrap();let path=root.join("run.db");
    let store=HandoffStore::open(path.to_str().unwrap(),Some(&contract),Some(&demo["config"]))?;
    let artifacts=FileArtifacts::new(root.join("material").to_str().unwrap())?;
    artifacts.put(b"hello","artifact:1","text/plain","human:operator","10000",None)?;
    // Fixed demo host principal. Production must authenticate and evaluate policy;
    // a client must never supply this authority object.
    let authority=json!({"allowed":true,"actorId":"human:operator","actorKind":"HUMAN",
        "policy":{"id":"policy","revision":"1"},"authorizedAtMs":"10","materials":{},"materialErrors":{},
        "admissions":demo["steps"].as_array().unwrap().last().unwrap()["facts"]["admissions"],
        "clearEvidence":["material:1","evidence:1"],"restartAllowed":true});
    let authorize=move|_:&Value,_:&HandoffState,_:&str|Ok(authority.clone());
    let mut coordinator=HandoffCoordinator::new(store,authorize,||"10".into(),artifacts);
    let mut tokens:BTreeMap<String,String>=BTreeMap::new();
    for template in demo["steps"].as_array().unwrap(){
        let snapshot=coordinator.store.snapshot()?;let s=snapshot.as_value();let mut request=template["request"].clone();
        let epoch=s["core"]["runs"]["r"].get("epoch").cloned().unwrap_or(json!("0"));
        request["expectedRevision"]=s["revision"].clone();request["ownerEpoch"]=epoch.clone();
        if request["command"].get("body").is_some(){
            request["command"]["expectedRevision"]=s["revision"].clone();request["command"]["ownerEpoch"]=epoch.clone();
            let b=&mut request["command"]["body"];
            if b["type"]=="commitBoundary"{
                let m=&mut b["manifest"];m["basis"]=json!({"revision":s["revision"],"eventHash":s["lastHash"]});
                m["controls"]["accounting"]["revision"]=s["revision"].clone();
                m["inputs"]=s["consumptions"].as_object().unwrap().values().find(|c|c["nodeId"]==m["producer"]["nodeId"]).unwrap()["inputs"].clone();
                m["producer"]["activationId"]=json!(activation(&snapshot,"r",m["producer"]["nodeId"].as_str().unwrap())?);
            }
            if b["type"]=="acknowledgeDelivery"{
                let id=b["deliveryId"].as_str().unwrap().to_owned();let d=&s["deliveries"][&id];
                b["claimToken"]=json!(tokens[&id]);b["generation"]=d["generation"].clone();b["handoff"]=d["handoff"].clone();
            }
            if b["type"]=="admitConsumer"{
                let c=&mut b["consumption"];c["ownerEpoch"]=epoch;c["revision"]=json!((s["revision"].as_str().unwrap().parse::<u64>().unwrap()+1).to_string());
                for input in c["inputs"].as_array_mut().unwrap(){input["handoff"]=s["deliveries"][input["deliveryId"].as_str().unwrap()]["handoff"].clone();}
            }
        }
        if request["command"]["body"]["type"]=="claimDelivery"{
            let (_,token)=coordinator.claim(&request)?;tokens.insert(request["command"]["body"]["deliveryId"].as_str().unwrap().to_owned(),token);
        }else{coordinator.apply(&request)?;}
    }
    let before=sha(coordinator.store.snapshot()?.as_value())?;drop(coordinator);
    let mut reopened=HandoffStore::open(path.to_str().unwrap(),None,None)?;
    assert_eq!(sha(reopened.snapshot()?.as_value())?,before);assert_eq!(report(&reopened.snapshot()?)?["spent"],"3");
    // A real exporter acknowledges after durable acceptance by its receiver.
    for event in reopened.pending_events(100)?{assert!(event["eventId"].is_string());reopened.acknowledge_event(event["sequence"].as_str().unwrap())?;}
    assert!(reopened.pending_events(100)?.is_empty());drop(reopened);std::fs::remove_dir_all(root).unwrap();
    println!("PASS: handoff-coordinator");Ok(())
}

