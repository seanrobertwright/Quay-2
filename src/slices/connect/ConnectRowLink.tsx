import { askForConnectRow } from "./antigravity.ts";

interface ConnectRowLinkProps {
  /** Called as it is pressed, before the row is asked for. */
  onPress: () => void;
}

/** The link to the Connect row for Antigravity. */
export const ConnectRowLink = ({ onPress }: ConnectRowLinkProps) => (
  <button
    type="button"
    onClick={() => {
      onPress();
      askForConnectRow();
    }}
    className="text-[#58a6ff] hover:text-[#79c0ff] hover:underline cursor-pointer"
  >
    Connect Antigravity in Settings
  </button>
);
