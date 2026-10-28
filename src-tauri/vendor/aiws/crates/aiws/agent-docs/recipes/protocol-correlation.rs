use aiws_sdk::*;
use serde_json::json;

fn main()->Result<()>{
    let contract=Contract::parse(&json!({"id":"contract:protocol","missionId":"mission:protocol","aiwsEdition":"0.4","profile":"finite-v1","budget":"20","deadline":"1000","criteria":["remote-result-reviewed"],"actions":["remote.invoke"],"resources":["protocol:mcp"],"requiresApproval":false,"maxAttempts":"2","maxAuthorizationAgeMs":"100","features":[]}).to_string())?;
    let mut state=create_mission(&contract)?;
    state=reduce(&state,&Command::from_value(json!({"type":"startRun","runId":"run:1"}))?,"10")?;
    state=reduce(&state,&Command::from_value(json!({"type":"grant","grant":{"id":"grant:1","subject":"agent:1","profile":"finite-v1","actions":["remote.invoke"],"resources":["protocol:mcp"],"notBefore":"0","expiresAt":"1000","limit":"20","canDelegate":false,"depth":"0"}}))?,"10")?;
    state=reduce(&state,&Command::from_value(json!({"type":"admit","runId":"run:1","operationId":"operation:1","attemptId":"attempt:1","grantId":"grant:1","subject":"agent:1","action":{"capability":"remote.invoke","resource":"protocol:mcp","payload":{"tool":"echo"},"preconditions":{}},"amount":"5","authorizationCheckedAt":"10","policy":"ALLOW","mandatoryChecksOk":true}))?,"10")?;

    let correlation=protocol_correlation(
        ProtocolBindingRef{binding_id:"mcp:official-v2".into(),binding_revision:"1".into(),protocol:"MCP".into(),protocol_version:"2026-07-28".into(),manifest_digest:"a".repeat(64),capability_digest:"b".repeat(64)},
        ProtocolOperationRef{work_order_id:"mission:protocol".into(),run_id:"run:1".into(),task_id:None,operation_id:"operation:1".into(),attempt_id:"attempt:1".into(),remote_identity_ref:Some("mcp:praxis-m9-fixture@1.0.0".into()),remote_operation_id:None}
    ).map_err(|code|AiwsError{code})?;
    assert_eq!(correlation.operation.operation_id,"operation:1");
    assert!(!correlation.authoritative);
    assert_eq!(state.as_value()["operations"]["operation:1"]["runId"],json!("run:1"));
    println!("PASS: protocol-correlation");
    Ok(())
}

