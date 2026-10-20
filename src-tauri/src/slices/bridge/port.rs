use std::env::VarError;

/// Environment variable that pins the bridge's loopback port.
pub const BRIDGE_PORT_VAR: &str = "QUAY_BRIDGE_PORT";

/// Turns the raw `QUAY_BRIDGE_PORT` lookup into the port the bridge pins.
/// Unset or empty gives `None`: the bridge takes a random port from the OS.
pub fn parse_bridge_port(raw: Result<String, VarError>) -> Result<Option<u16>, String> {
    match raw {
        Err(VarError::NotPresent) => Ok(None),
        Ok(value) if value.is_empty() => Ok(None),
        Ok(value) if !value.bytes().all(|b| b.is_ascii_digit()) => Err(invalid(&value)),
        Ok(value) => match value.parse::<u16>() {
            Ok(port) if port != 0 => Ok(Some(port)),
            _ => Err(invalid(&value)),
        },
        Err(VarError::NotUnicode(value)) => Err(invalid(&value.to_string_lossy())),
    }
}

fn invalid(value: &str) -> String {
    format!(
        "{} is set to {:?}, which is not a port number from 1 to 65535; \
         unset it or leave it empty for a random port",
        BRIDGE_PORT_VAR, value
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unset_keeps_the_random_port() {
        assert_eq!(parse_bridge_port(Err(VarError::NotPresent)), Ok(None));
    }

    #[test]
    fn empty_keeps_the_random_port() {
        assert_eq!(parse_bridge_port(Ok(String::new())), Ok(None));
    }

    #[test]
    fn a_valid_port_is_pinned() {
        assert_eq!(parse_bridge_port(Ok("47100".to_string())), Ok(Some(47100)));
    }

    #[test]
    fn zero_is_rejected_rather_than_meaning_random() {
        let err = parse_bridge_port(Ok("0".to_string())).unwrap_err();
        assert!(err.contains("QUAY_BRIDGE_PORT"), "{err}");
        assert!(err.contains("\"0\""), "{err}");
    }

    #[test]
    fn a_port_above_65535_is_rejected() {
        let err = parse_bridge_port(Ok("65536".to_string())).unwrap_err();
        assert!(err.contains("QUAY_BRIDGE_PORT"), "{err}");
        assert!(err.contains("\"65536\""), "{err}");
    }

    #[test]
    fn a_non_numeric_value_is_rejected() {
        let err = parse_bridge_port(Ok("abc".to_string())).unwrap_err();
        assert!(err.contains("QUAY_BRIDGE_PORT"), "{err}");
        assert!(err.contains("\"abc\""), "{err}");
    }

    #[test]
    fn a_signed_or_padded_number_is_rejected() {
        for raw in ["+47100", " 47100", "47100 "] {
            assert!(parse_bridge_port(Ok(raw.to_string())).is_err(), "{raw:?}");
        }
    }

    #[test]
    fn a_non_unicode_value_is_rejected() {
        let raw = Err(VarError::NotUnicode(std::ffi::OsString::from("x")));
        let err = parse_bridge_port(raw).unwrap_err();
        assert!(err.contains("QUAY_BRIDGE_PORT"), "{err}");
    }
}
