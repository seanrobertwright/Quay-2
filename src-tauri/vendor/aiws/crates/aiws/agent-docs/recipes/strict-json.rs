use aiws_sdk::*;
use serde_json::json;
fn main() -> Result<()> {
    assert_eq!(parse_strict(r#"{"id":"a","id":"b"}"#).unwrap_err().code, "DUPLICATE_KEY");
    let action = Action::from_value(json!({"capability":"write","resource":"doc","payload":{"value":1},"preconditions":{"revision":1}}))?;
    println!("{}", fingerprint(&action)?);
    Ok(())
}

