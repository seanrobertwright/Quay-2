//! What the operator has put in a surface and not sent, at the seam the webview uses.

use serde_json::{json, Value};

use super::store::SurfaceKey;
use super::test_seam::{answer, asked, start, CapturedLog, FakeWebview, Seam};
use super::timing::Timing;
use super::unsent::UnsentRefused;

fn ask_1() -> SurfaceKey {
    SurfaceKey::new("term-a", "ask_1")
}

/// The order `key`'s surface has.
fn order_of(seam: &Seam, key: &SurfaceKey) -> u64 {
    let surfaces = seam.surfaces.surfaces();
    surfaces.iter().find(|s| s.terminal_id == key.terminal_id && s.id == key.id).expect("no such surface").order
}

/// A save of `text` in `key`'s surface: the `save`th of page `page`.
fn unsent(seam: &Seam, key: &SurfaceKey, (page, save): (u64, u64), text: &str) -> Value {
    let values = json!({ "/answers/0/text": text });
    json!({ "page": page, "save": save, "order": order_of(seam, key), "revision": 1, "values": values })
}

fn send(seam: &Seam, key: &SurfaceKey, unsent: Value) -> Result<(), UnsentRefused> {
    seam.surfaces.save_unsent(key, serde_json::from_value(unsent).unwrap())
}

fn save(seam: &Seam, key: &SurfaceKey, at: (u64, u64), text: &str) -> Result<(), UnsentRefused> {
    send(seam, key, unsent(seam, key, at, text))
}

/// What a page that loads is given.
fn load(seam: &Seam) -> Value {
    json!(seam.surfaces.open_page())
}

/// The text held for each surface, by terminal and id, as a page that loads is given it.
fn held(seam: &Seam) -> Vec<[String; 3]> {
    let page = load(seam);
    let text = |value: &Value| value.as_str().unwrap().to_string();
    let unsent = page["unsent"].as_array().unwrap().iter();
    let mut held: Vec<_> =
        unsent.map(|u| [text(&u["terminal_id"]), text(&u["id"]), text(&u["values"]["/answers/0/text"])]).collect();
    held.sort();
    held
}

fn one(terminal_id: &str, id: &str, text: &str) -> [String; 3] {
    [terminal_id, id, text].map(String::from)
}

/// A seam whose `term-a` has asked `ask_1`.
async fn with_question() -> (Seam, FakeWebview) {
    let (seam, mut webview) = start(Timing::default()).await;
    asked(&seam, &mut webview, "term-a").await;
    (seam, webview)
}

#[tokio::test]
async fn what_is_unsent_is_given_to_a_page_that_loads() {
    let (seam, _webview) = with_question().await;
    assert_eq!(load(&seam), json!({ "page": 1, "unsent": [] }));

    save(&seam, &ask_1(), (1, 1), "half a thought").unwrap();

    assert_eq!(
        load(&seam),
        json!({ "page": 2, "unsent": [{
            "terminal_id": "term-a",
            "id": "ask_1",
            "order": order_of(&seam, &ask_1()),
            "revision": 1,
            "values": { "/answers/0/text": "half a thought" },
        }] })
    );
}

#[tokio::test]
async fn a_save_that_arrives_late_does_not_overwrite_a_newer_one() {
    let (seam, _webview) = with_question().await;
    let key = ask_1();
    let newest = |text: &str| assert_eq!(held(&seam), [one("term-a", "ask_1", text)]);

    save(&seam, &key, (1, 2), "second").unwrap();
    assert_eq!(save(&seam, &key, (1, 1), "first"), Err(UnsentRefused::OlderSave));
    assert_eq!(save(&seam, &key, (1, 2), "second again"), Err(UnsentRefused::OlderSave));
    newest("second");

    // A page that loads counts its saves from the start, and the last of the page before may come after
    save(&seam, &key, (2, 1), "after a reload").unwrap();
    assert_eq!(save(&seam, &key, (1, 3), "as the page went"), Err(UnsentRefused::OlderSave));
    newest("after a reload");
    save(&seam, &key, (2, 2), "").unwrap();
    newest("");
}

#[tokio::test]
async fn what_is_unsent_in_one_question_is_no_other_questions() {
    let (seam, mut webview) = with_question().await;
    asked(&seam, &mut webview, "term-a").await;
    asked(&seam, &mut webview, "term-b").await;
    let [a2, b1] = [("term-a", "ask_2"), ("term-b", "ask_1")].map(|(terminal, id)| SurfaceKey::new(terminal, id));

    save(&seam, &ask_1(), (1, 1), "a1").unwrap();
    save(&seam, &b1, (1, 2), "b1").unwrap();
    assert_eq!(held(&seam), [one("term-a", "ask_1", "a1"), one("term-b", "ask_1", "b1")]);

    let of_the_other = unsent(&seam, &ask_1(), (1, 3), "read from ask_1");
    for key in [a2, b1] {
        assert_eq!(send(&seam, &key, of_the_other.clone()), Err(UnsentRefused::NoSuchSurface));
    }
    let missing = [SurfaceKey::new("term-a", "ask_9"), SurfaceKey::new("term-c", "ask_1")];
    for key in missing {
        assert_eq!(send(&seam, &key, of_the_other.clone()), Err(UnsentRefused::NoSuchSurface));
    }
    assert_eq!(held(&seam), [one("term-a", "ask_1", "a1"), one("term-b", "ask_1", "b1")]);
}

#[tokio::test]
async fn what_was_read_from_another_revision_is_not_kept() {
    let (seam, _webview) = with_question().await;
    for revision in [0, 2] {
        let mut read = unsent(&seam, &ask_1(), (1, 1), "half a thought");
        read["revision"] = json!(revision);
        assert_eq!(send(&seam, &ask_1(), read), Err(UnsentRefused::OtherRevision));
    }
    assert!(held(&seam).is_empty());
}

#[tokio::test]
async fn it_goes_when_the_question_is_answered_and_a_save_after_that_is_not_kept() {
    let (seam, _webview) = with_question().await;
    save(&seam, &ask_1(), (1, 1), "half a thought").unwrap();
    let late = unsent(&seam, &ask_1(), (1, 2), "a whole one");

    seam.surfaces.answer(&ask_1(), 2, answer()).unwrap_err();
    assert_eq!(held(&seam).len(), 1, "an answer that is not taken leaves it");
    seam.surfaces.answer(&ask_1(), 1, answer()).unwrap();

    assert!(held(&seam).is_empty());
    assert_eq!(send(&seam, &ask_1(), late), Err(UnsentRefused::NoSuchSurface));
    assert!(held(&seam).is_empty());
}

#[tokio::test]
async fn it_is_held_up_to_256_kb_and_a_larger_one_leaves_what_was_held() {
    let (seam, _webview) = with_question().await;
    // What the values take as JSON, without the text
    let around = json!({ "/answers/0/text": "" }).to_string().len();
    let largest = "x".repeat(256 * 1024 - around);

    save(&seam, &ask_1(), (1, 1), &largest).unwrap();
    assert_eq!(save(&seam, &ask_1(), (1, 2), &format!("{largest}x")), Err(UnsentRefused::TooLarge));
    assert!(held(&seam) == [one("term-a", "ask_1", &largest)]);

    // Counted in bytes, as JSON writes them
    let escaped = "\u{1}".repeat(256 * 1024 / 6);
    assert_eq!(save(&seam, &ask_1(), (1, 3), &escaped), Err(UnsentRefused::TooLarge));
}

#[tokio::test]
async fn it_is_neither_logged_nor_part_of_the_surface_that_is_sent_around() {
    let (log, _guard) = CapturedLog::start();
    let (seam, _webview) = with_question().await;
    save(&seam, &ask_1(), (1, 2), "half a secret").unwrap();
    save(&seam, &ask_1(), (1, 1), "half a secret").unwrap_err();
    save(&seam, &ask_1(), (1, 3), &"half a secret".repeat(256 * 1024)).unwrap_err();

    assert_eq!(held(&seam), [one("term-a", "ask_1", "half a secret")]);
    assert!(!log.text().contains("secret"));
    assert!(!json!(seam.surfaces.surfaces()).to_string().contains("secret"));
}
