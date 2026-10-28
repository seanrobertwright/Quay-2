// The graph binding (aiws-graph-binding/1) is a PROVISIONAL Praxis document, not an SDK record.
// Clients vendor its schema and fixtures; this test runs them through the jsonschema crate the SDK
// already uses and pins graphDigest to this crate's digest of the finite-v1 graph.
use aiws_sdk::digest;
use aiws_sdk::workflow::validate_graph;
use serde_json::Value;
fn schema() -> Value { serde_json::from_str(include_str!("../../../spec/engine-v1/graph-binding.schema.json")).unwrap() }
fn fixtures() -> Value { serde_json::from_str(include_str!("../../../spec/engine-v1/graph-binding.fixtures.json")).unwrap() }

#[test]
fn graph_binding_fixtures_validate_against_the_schema() {
    let schema = schema();
    assert_eq!(schema["x-aiws-format"], "aiws-graph-binding/1");
    assert_eq!(schema["x-aiws-stability"], "PROVISIONAL");
    let validator = jsonschema::validator_for(&schema).unwrap();
    let fixtures = fixtures();
    let cases = fixtures["cases"].as_array().unwrap();
    for case in cases {
        assert_eq!(validator.is_valid(&case["record"]), case["valid"].as_bool().unwrap(), "{}", case["name"]);
    }
    assert!(cases.iter().any(|c| c["valid"] == true) && cases.iter().any(|c| c["valid"] == false));
}

#[test]
fn graph_digest_is_the_sdk_digest_of_the_graph() {
    let fixtures = fixtures();
    for vector in fixtures["graphs"].as_array().unwrap() {
        validate_graph(&vector["graph"]).unwrap();
        assert_eq!(digest(&vector["graph"]).unwrap(), vector["digest"].as_str().unwrap(), "{}", vector["graph"]["id"]);
    }
}
