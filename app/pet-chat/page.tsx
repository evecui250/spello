'use client';

import PetChatFlow from '../../components/PetChatFlow';

// Standalone page for the "Text to Pet" conversation feature — reached by
// tapping the pet on Home. No query string, no server-side state to read
// on mount (unlike /game's ?source= routing) — the whole flow lives inside
// PetChatFlow itself. Plain route rather than a modal (see this feature's
// own plan): a multi-turn chat with a keyboard needs real vertical space,
// same reasoning /practice and /game already reflect.
export default function PetChatPage() {
  return <PetChatFlow />;
}
