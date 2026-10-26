use aiws_sdk::{protocol_correlation,validate_protocol_correlation,ProtocolBindingRef,ProtocolOperationRef};

fn binding()->ProtocolBindingRef{ProtocolBindingRef{binding_id:"agui:operator".into(),binding_revision:"1".into(),protocol:"AG_UI".into(),protocol_version:"1.0".into(),manifest_digest:"a".repeat(64),capability_digest:"b".repeat(64)}}
fn operation()->ProtocolOperationRef{ProtocolOperationRef{work_order_id:"work:1".into(),run_id:"run:1".into(),task_id:Some("task:1".into()),operation_id:"operation:1".into(),attempt_id:"attempt:1".into(),remote_identity_ref:Some("browser session".into()),remote_operation_id:Some("interrupt 42".into())}}

#[test]
fn portable_non_authoritative_identity(){
    let value=protocol_correlation(binding(),operation()).unwrap();
    assert_eq!(value.profile,"aiws-protocol-correlation/1");
    assert!(!value.authoritative);
    assert_eq!(value.binding.protocol_version,"1.0");
}
#[test]
fn rejects_authority_and_bad_material(){
    let mut value=protocol_correlation(binding(),operation()).unwrap();value.authoritative=true;
    assert_eq!(validate_protocol_correlation(&value).unwrap_err(),"INVALID_PROTOCOL_CORRELATION");
    let mut b=binding();b.binding_revision="01".into();
    assert_eq!(protocol_correlation(b,operation()).unwrap_err(),"INVALID_PROTOCOL_BINDING_REVISION");
    let mut b=binding();b.capability_digest="changed".into();
    assert_eq!(protocol_correlation(b,operation()).unwrap_err(),"INVALID_PROTOCOL_DIGEST");
}
#[test]
fn deserializing_takes_an_exact_key_set(){
    let value=serde_json::to_value(protocol_correlation(binding(),operation()).unwrap()).unwrap();
    assert!(serde_json::from_value::<aiws_sdk::ProtocolCorrelation>(value.clone()).is_ok());
    let mut unknown=value.clone();unknown["operation"]["approvalId"]="approval:1".into();
    assert!(serde_json::from_value::<aiws_sdk::ProtocolCorrelation>(unknown).is_err());
    let mut missing=value.clone();missing["operation"].as_object_mut().unwrap().remove("taskId");
    assert!(serde_json::from_value::<aiws_sdk::ProtocolCorrelation>(missing).is_err());
    let mut null=value;null["operation"]["taskId"]=serde_json::Value::Null;
    assert_eq!(serde_json::from_value::<aiws_sdk::ProtocolCorrelation>(null).unwrap().operation.task_id,None);
}
