//! Immutable checked records with native closed-schema validation.
use crate::{Result,parse_strict};
use serde_json::Value;
macro_rules! record {($name:ident,$kind:literal)=>{
 #[derive(Clone,Debug)] pub struct $name(Value);
 impl $name {
  pub fn from_value(value:Value)->Result<Self>{Ok(Self(crate::handoff::checked($kind,&value)?))}
  pub fn parse(text:&str)->Result<Self>{Self::from_value(parse_strict(text)?)}
  pub fn as_value(&self)->&Value{&self.0}
 }
};}
record!(HandoffManifest,"Manifest");
record!(HandoffDelivery,"Delivery");
record!(HandoffConsumption,"Consumption");
record!(HandoffHold,"Hold");
record!(HandoffSummary,"Summary");
record!(HandoffCommand,"Command");
record!(HandoffInvalidation,"Invalidation");
