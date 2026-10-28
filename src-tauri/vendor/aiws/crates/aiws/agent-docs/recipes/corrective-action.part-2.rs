// Part 2 of 2 of corrective-action.rs: concatenate the parts, without these first lines, for the whole program.
fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    let contract = Contract::parse(&json!({
        "id":"example:contract:guarding-17:1","missionId":"example:mission:guarding-17","aiwsEdition":"0.4","profile":"finite-v1",
        "budget":"100","deadline":"28800000","maxAttempts":"2","maxAuthorizationAgeMs":"1000","requiresApproval":false,"features":["graphs"],
        "criteria":CRITERIA,
        "actions":["read-records","draft","update-case","notify"],"resources":["inspection-records","case-draft","case:guarding-17","case-owner-inbox"]}).to_string())?;
    // The resource envelope, approved by a human before the run: 100 capability calls and 8 elapsed hours.
    let run_scope = |run_id: &str| json!({"id":run_id,"parentId":WORK_ORDER,"kind":"RUN","workOrderId":WORK_ORDER,"runId":run_id,"nodeId":null,"dependsOn":[],"startMs":"0",
        "limits":{"cost":null,"handoff":"0","activeMs":null,"elapsedMs":null,"attempts":null}});
    let envelope = parse_strict(&json!({"protocol":"aiws-limits/1","ledgerId":"example:ledger:guarding-17","costUnit":"capability-call",
        "approvalRef":"example:approval:resource-envelope","scopes":[
        {"id":WORK_ORDER,"parentId":null,"kind":"WORK_ORDER","workOrderId":WORK_ORDER,"runId":null,"nodeId":null,"dependsOn":[],"startMs":"0",
            "limits":{"cost":"100","handoff":"10","activeMs":null,"elapsedMs":"28800000","attempts":"100"}},
        run_scope(RUN), run_scope(FOLLOW_UP)]}).to_string())?;
    // Run 1's plan is assembling and assessing the available package, so it can complete while acceptance is deferred.
    // The SDK completes a VERIFICATION node only on PASSED and an ACCEPTANCE node only on ACCEPTED, so run 1 is assessed
    // after it completes, and those nodes belong to the follow-up run, whose active task is obtaining the evidence.
    let package_graph = json!({"id":"example:graph:corrective-action","revision":"1","nodes":[
        {"id":"collect-records","kind":"TASK","dependsOn":[],"config":{"executionKind":"AGENT"}},
        {"id":"request-more-records","kind":"LOOP","dependsOn":["collect-records"],"config":{"maxIterations":"3"}},
        {"id":"draft-action","kind":"TASK","dependsOn":["request-more-records"],"config":{"executionKind":"AGENT"}},
        {"id":"engineering-review","kind":"APPROVAL","dependsOn":["draft-action"],"config":{}},
        {"id":"update-case","kind":"TASK","dependsOn":["engineering-review"],"config":{"executionKind":"TOOL"}},
        {"id":"end","kind":"END","dependsOn":["update-case"],"config":{}}]});
    let follow_up_graph = json!({"id":"example:graph:implementation-evidence","revision":"1","nodes":[
        {"id":"implementation-evidence","kind":"WAIT","dependsOn":[],"config":{}},
        {"id":"verification","kind":"VERIFICATION","dependsOn":["implementation-evidence"],"config":{}},
        {"id":"acceptance","kind":"ACCEPTANCE","dependsOn":["verification"],"config":{}},
        {"id":"notify-case-owner","kind":"TASK","dependsOn":["acceptance"],"config":{"executionKind":"TOOL"}},
        {"id":"follow-up-end","kind":"END","dependsOn":["notify-case-owner"],"config":{}}]});
    let directory = std::env::temp_dir().join(format!("aiws-annex-b-{}-{}", std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_nanos()));
    std::fs::create_dir(&directory)?;
    std::fs::write(directory.join("case-record.json"), canonical(&json!({"caseId":CASE,"version":1,"status":"OPEN","correctiveAction":null,"evidence":[],"history":[]}))?)?;
    let mut host = Host {
        store: None, ledger_store: None, contract: contract.clone(), envelope, clock: ScriptedClock(Rc::new(Cell::new(0))), directory: directory.clone(),
        routes: Rc::default(), evidence: Rc::default(), acknowledgments_to_drop: Rc::new(Cell::new(1)),
        trail: vec![], inbox: VecDeque::new(), collected: vec![], record_revisions: vec![], attestation: String::new(), start_ups: vec![], denials: vec![],
    };
    host.start_up()?;
    host.start(RUN, &package_graph)?;
    let grant = host.root_grant();
    host.mission(&OWNER, json!({"type":"grant","grant":grant}))?;
    host.overstep();
    host.until_stopped(RUN)?;
    host.start_up()?;
    host.drive(RUN)?;
    // The designated verifier assesses the completed package. Implementation evidence is missing, so the criteria that
    // need it are INCONCLUSIVE and acceptance is DEFERRED; neither is turned into a pass.
    host.clock.0.set(host.clock.0.get() + 600000);
    let evidence = host.package_evidence();
    host.mission(&VERIFIER, json!({"type":"verify","runId":RUN,"assessor":VERIFIER.actor,"revision":VERIFICATION,
        "results":{"issue-identified":"PASS","engineering-reviewed":"PASS","implementation-evidenced":"INCONCLUSIVE","effectiveness-accepted":"INCONCLUSIVE"},
        "evidence":evidence,"rationale":"Records, reviewed draft and case receipt support the first two criteria; no implementation evidence yet"}))?;
    host.clock.0.set(host.clock.0.get() + 600000);
    host.mission(&VERIFIER, json!({"type":"accept","runId":RUN,"authority":VERIFIER.actor,"verificationRevision":VERIFICATION,"decision":"DEFERRED",
        "rationale":"Await authorized implementation evidence and assessment"}))?;
    // The linked follow-up run obtains the implementation evidence and is verified and accepted on it.
    host.start(FOLLOW_UP, &follow_up_graph)?;
    host.until_stopped(FOLLOW_UP)?;
    // The notification is still UNKNOWN after this start-up, so the host holds the follow-up run for a human.
    host.start_up()?;
    let now = host.clock.now_ms();
    let exported = host.store.as_mut().unwrap().flush_telemetry(&mut Collector, &now, 1000)?;
    let snapshot = host.store.as_ref().unwrap().snapshot()?;
    let final_state = snapshot.as_value();
    let audit = parse_strict(&host.store.as_ref().unwrap().export_audit()?)?;
    let ledger_store = host.ledger_store.as_ref().unwrap();
    let approval = &final_state["approvals"][APPROVAL];
    let update = &final_state["operations"]["example:operation:update-case"];
    let settles: Vec<Value> = ledger_store.export_events()?.into_iter().filter(|e| e["request"]["command"]["type"] == "settle").collect();
    let ledger_state = ledger_store.snapshot()?;
    let usage = ledger_store.report(&now)?["scopes"].as_array().unwrap().iter().find(|s| s["scopeId"] == WORK_ORDER).unwrap()["usage"].clone();
    let effects: Vec<Value> = host.trail.iter().map(|(attempt_id, order)| {
        let (attempt, held) = (&final_state["attempts"][attempt_id], &ledger_state["attempts"][attempt_id]);
        let operation = &final_state["operations"][attempt["operationId"].as_str().unwrap()];
        let facts = settles.iter().find(|e| e["request"]["command"]["attemptId"] == attempt_id.as_str()).map(|e| e["facts"].clone()).unwrap_or(Value::Null);
        json!({"operationId":operation["id"],"nodeId":operation["nodeId"],"effect":attempt["effect"],"actualCost":attempt["actualCost"],"order":order,
            "ledger":{"status":held["status"],"amount":held["amount"],"actualCost":held["actualCost"],"evidenceRef":facts["evidenceRef"],"settledBy":facts["actorId"]}})
    }).collect();
    let outcome = |run_id: &str| -> Result<Value> {
        let (assessment, success) = (&final_state["assessments"][run_id], assess_success(&snapshot, run_id)?);
        Ok(json!({"executionState":final_state["runs"][run_id]["state"],"verificationState":assessment["verification"],"acceptanceState":assessment["acceptance"],
            "verifiedSuccessful":success["verifiedSuccessful"],"reasons":success["reasons"]}))
    };
    let (package_outcome, mut follow_up) = (outcome(RUN)?, outcome(FOLLOW_UP)?);
    follow_up["runId"] = json!(FOLLOW_UP);
    let c = contract.as_value();
    let grant = &final_state["grants"][GRANT];
    let granted_by = &final_state["events"].as_array().unwrap().iter().find(|e| e["command"]["type"] == "grant").unwrap()["command"]["context"]["actor"];
    let assessments: Vec<Value> = [RUN, FOLLOW_UP].iter().map(|run_id| { let a = &final_state["assessments"][run_id];
        json!({"runId":run_id,"revision":a["revision"],"assessor":a["assessor"],"verification":a["verification"],"evidence":a["evidence"],
            "authority":a["acceptanceRecord"]["authority"],"acceptance":a["acceptance"]}) }).collect();
    let record = json!({
        // Annex B's illustrative result record, for run 1.
        "result":{"exampleOnly":true,"runId":RUN,"executionState":package_outcome["executionState"],"verificationState":package_outcome["verificationState"],
            "acceptanceState":package_outcome["acceptanceState"],"missionId":c["missionId"],"contractRevision":c["id"],
            "verifiedSuccessful":package_outcome["verifiedSuccessful"],
            "criterionResults":CRITERIA.iter().map(|id| json!({"criterionId":id,"verdict":final_state["assessments"][RUN]["results"][id]})).collect::<Vec<_>>(),
            "disposition":final_state["assessments"][RUN]["acceptanceRecord"]["rationale"]},
        "followUp":follow_up,
        "approval":{"id":APPROVAL,"approver":approval["approver"],"fingerprint":approval["fingerprint"],"expiresAt":approval["expiresAt"],"uses":approval["uses"],
            "consumedBy":approval["operations"],"caseUpdate":{"fingerprint":update["fingerprint"],"preconditions":update["action"]["preconditions"],
                "update":update["action"]["payload"]["update"],"evidence":update["action"]["payload"]["evidence"]}},
        "effects":effects,
        "startUps":host.start_ups,
        "grant":{"id":GRANT,"grantedBy":granted_by,"limit":grant["limit"],"canDelegate":grant["canDelegate"],"depth":grant["depth"],
            "grants":final_state["grants"].as_object().unwrap().keys().collect::<Vec<_>>(),"workOrderCostLimit":ledger_state["scopes"][WORK_ORDER]["limits"]["cost"]},
        "denials":host.denials,
        "rejections":audit["diagnostics"].as_array().unwrap().iter().map(|d| json!({"rejectedType":d["command"]["rejectedType"],"code":d["command"]["code"],
            "actor":d["command"]["context"]["actor"]})).collect::<Vec<_>>(),
        "assessments":assessments,
        "accounting":{"missionSpent":final_state["spent"],"missionReserved":final_state["reserved"],"ledgerCost":usage["cost"],"ledgerAttempts":usage["attempts"]},
        "telemetry":{"exported":exported.as_array().unwrap().len(),"allSent":exported.as_array().unwrap().iter().all(|r| r["status"] == "SENT")},
    });
    // Run 1 ends exactly as Annex B's illustrative result after physical implementation evidence is missing.
    assert_eq!(record["result"], json!({"exampleOnly":true,"runId":"example:run:guarding-17","executionState":"COMPLETED","verificationState":"INCONCLUSIVE",
        "acceptanceState":"DEFERRED","missionId":"example:mission:guarding-17","contractRevision":"example:contract:guarding-17:1","verifiedSuccessful":false,
        "criterionResults":[{"criterionId":"issue-identified","verdict":"PASS"},{"criterionId":"engineering-reviewed","verdict":"PASS"},
            {"criterionId":"implementation-evidenced","verdict":"INCONCLUSIVE"},{"criterionId":"effectiveness-accepted","verdict":"INCONCLUSIVE"}],
        "disposition":"Await authorized implementation evidence and assessment"}));
    // The follow-up run, given the implementation evidence, is verified and accepted, but it is not a verified success:
    // its notification is UNKNOWN, so the run stays held and cannot complete.
    assert_eq!(record["followUp"], json!({"runId":FOLLOW_UP,"executionState":"RUNNING","verificationState":"PASSED","acceptanceState":"ACCEPTED",
        "verifiedSuccessful":false,"reasons":["EXECUTION_NOT_COMPLETED","EFFECT_UNKNOWN"]}));
    // Annex B: the effectiveness assessment is made and accepted by the designated verifier.
    for assessment in record["assessments"].as_array().unwrap() {
        assert_eq!(json!([assessment["assessor"], assessment["authority"]]), json!([VERIFIER.actor, VERIFIER.actor]));
    }
    // The approval is bound to the exact case update: same fingerprint, consumed once, by that write alone.
    const REVIEWED_FINGERPRINT: &str = "sha256:dc6286da8ce3fcc52283ea5fa2cba15dea085ecc67213a4f4bf18426888154ab";
    assert_eq!(record["approval"]["fingerprint"], REVIEWED_FINGERPRINT);
    assert_eq!(record["approval"]["caseUpdate"]["fingerprint"], REVIEWED_FINGERPRINT);
    assert_eq!(record["approval"]["consumedBy"], json!(["example:operation:update-case"]));
    assert_eq!(record["approval"]["caseUpdate"]["preconditions"], json!({"version":1}));
    // Every effect was reserved before dispatch and settled after it, with the evidence that settled it.
    let effects = record["effects"].as_array().unwrap();
    let nodes: Vec<&Value> = effects.iter().map(|e| &e["nodeId"]).collect();
    assert_eq!(nodes, ["collect-records", "request-more-records", "request-more-records", "draft-action", "update-case", "notify-case-owner"]);
    for effect in &effects[..5] {
        assert_eq!(json!([effect["effect"], effect["actualCost"], effect["ledger"]["status"], effect["ledger"]["amount"], effect["ledger"]["actualCost"]]),
            json!(["CONFIRMED_APPLIED", "1", "SETTLED", "1", "1"]));
        let evidence_ref = effect["ledger"]["evidenceRef"].as_str().unwrap();
        assert!(evidence_ref.starts_with("sha256:") && evidence_ref.len() == 71);
    }
    for effect in &effects[..4] {
        assert_eq!(effect["order"], json!(["ledger reserve", "mission admit", "ledger dispatch", "mission dispatch", "mission settle CONFIRMED_APPLIED", "ledger settle"]));
        assert_eq!(effect["ledger"]["settledBy"], WORKER.actor);
    }
    // The case write times out once: the write lands but its acknowledgment is lost, so the attempt is UNKNOWN and the
    // host stops. At the next start-up, recover fences the run and the read-only reconcile finds this operation's version
    // in the record. The ledger keeps the whole reservation until a human settles it on that read-back.
    assert_eq!(effects[4]["order"], json!(["ledger reserve", "mission admit", "ledger dispatch", "mission dispatch", "mission settle UNKNOWN",
        "ledger unknown", "mission recover", "mission reconcile CONFIRMED_APPLIED", "ledger settle"]));
    assert_eq!(effects[4]["ledger"]["settledBy"], OWNER.actor);
    // The placeholder adapter reports UNKNOWN from execute and reconcile alike. At the next start-up the notification is
    // still UNKNOWN: the ledger keeps its reservation, nothing settles it, and the host holds the run for a human.
    assert_eq!(effects[5], json!({"operationId":"example:operation:notify-case-owner","nodeId":"notify-case-owner","effect":"UNKNOWN","actualCost":null,
        "order":["ledger reserve","mission admit","ledger dispatch","mission dispatch","mission settle UNKNOWN","ledger unknown","mission recover","mission reconcile UNKNOWN"],
        "ledger":{"status":"UNKNOWN","amount":"1","actualCost":null,"evidenceRef":null,"settledBy":null}}));
    assert_eq!(record["startUps"], json!([{"recovered":[]},{"recovered":[{"runId":RUN,"segmentId":"example:run:guarding-17:segment:1",
        "reconciled":[{"attemptId":"example:operation:update-case:attempt:1","effect":"CONFIRMED_APPLIED"}]}]},
        {"recovered":[{"runId":FOLLOW_UP,"segmentId":"example:run:guarding-17:implementation:segment:1",
        "reconciled":[{"attemptId":"example:operation:notify-case-owner:attempt:1","effect":"UNKNOWN"}]}]}]));
    let package_evidence = record["assessments"][0]["evidence"].as_array().unwrap();
    let follow_up_evidence = record["assessments"][1]["evidence"].as_array().unwrap();
    assert_eq!(effects[4]["ledger"]["evidenceRef"], package_evidence[4]); // the case receipt
    assert_eq!(record["approval"]["caseUpdate"]["evidence"].as_array().unwrap()[..], package_evidence[..3]); // the record revisions it approved
    assert_eq!(std::fs::read_to_string(directory.join("case-record.json"))?, canonical(&json!({"caseId":CASE,"version":2,"status":"CORRECTIVE_ACTION_PROPOSED",
        "correctiveAction":package_evidence[3],"evidence":record["approval"]["caseUpdate"]["evidence"],"history":[{"version":2,"operationId":"example:operation:update-case"}]}))?);
    // The follow-up assessment cites the same package and adds the implementation attestation.
    assert_eq!(follow_up_evidence[..5], package_evidence[..]);
    assert_eq!(follow_up_evidence.len(), 6);
    // The human-authored root grant is narrower than the contract, and the agent could not widen it: its grant and its
    // request to raise the work order's cost limit were both denied, and nothing changed.
    assert_eq!(record["grant"], json!({"id":GRANT,"grantedBy":OWNER.actor,"limit":"10","canDelegate":false,"depth":"0","grants":[GRANT],"workOrderCostLimit":"100"}));
    assert_eq!(record["denials"], json!([{"command":"grant","actor":AGENT.actor,"refused":"AUTHORITY_DENIED"},{"command":"adjust","actor":AGENT.actor,"refused":"AUTHORIZATION_DENIED"}]));
    // The mission store records the denied grant, attributed to the agent; it is the run's only refused command.
    assert_eq!(record["rejections"], json!([{"rejectedType":"grant","code":"AUTHORITY_DENIED","actor":AGENT.actor}]));
    // Five settled capability calls, and the UNKNOWN notification's reservation still held in both stores.
    assert_eq!(record["accounting"], json!({"missionSpent":"5","missionReserved":"1","ledgerCost":"6","ledgerAttempts":"6"}));
    assert_eq!(record["telemetry"]["allSent"], true);
    // The real clock reads canonical epoch milliseconds, past the scripted contract's deadline.
    let utc = UtcClock.now_ms();
    assert!(!utc.starts_with('0') && utc.parse::<u128>()? > c["deadline"].as_str().unwrap().parse::<u128>()?);
    println!("{}", canonical(&record)?);
    Ok(())
}

