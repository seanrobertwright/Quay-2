use aiws_sdk::*;
use serde_json::Value;
#[test]
fn shared_scenarios() {
    let fixtures: Value = serde_json::from_str(include_str!("fixtures.json")).unwrap();
    for f in fixtures.as_array().unwrap() {
        if let Some(expected) = f["error"].as_str() {
            let result = Contract::from_value(f["contract"].clone()).and_then(|c| create_mission(&c));
            assert_eq!(result.unwrap_err().code, expected, "{}", f["name"]);
            continue;
        }
        let c = Contract::from_value(f["contract"].clone()).unwrap();
        let mut s = create_mission(&c).unwrap();
        for step in f["steps"].as_array().unwrap() {
            let result = Command::from_value(step["command"].clone())
                .and_then(|c| reduce(&s, &c, step["now"].as_str().unwrap()));
            if let Some(expected) = step["error"].as_str() {
                assert_eq!(result.unwrap_err().code, expected, "{}", f["name"]);
            } else {
                s = result
                    .unwrap_or_else(|e| panic!("{} {}: {}", f["name"], step["command"]["type"], e));
            }
            if let Some(expect) = step["expect"].as_object() {
                for (path, value) in expect {
                    assert_eq!(
                        s.as_value().pointer(path),
                        Some(value),
                        "{} {}",
                        f["name"],
                        path
                    );
                }
            }
        }
        assert_eq!(audit_playback(&c, &s.as_value()["events"]).unwrap(), s);
    }
}
#[test]
fn strict_json_and_schedule() {
    assert_eq!(
        parse_strict("{\"a\":1,\"a\":2}").unwrap_err().code,
        "DUPLICATE_KEY"
    );
    assert_eq!(
        parse_strict("9007199254740992").unwrap_err().code,
        "UNSAFE_NUMBER"
    );
    assert_eq!(
        workflow::due_slots("0", "10", "0", "35", "ALL", 2).unwrap(),
        serde_json::json!({"slots":["0","1"],"nextSlot":"2"})
    );
    assert_eq!(
        workflow::due_slots("0", "10", "0", "35", "SKIP", 2).unwrap(),
        serde_json::json!({"slots":[],"nextSlot":"4"})
    );
}
