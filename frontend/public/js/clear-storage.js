// The login page is where a session ends, so any client-side state left over
// from the previous session (drafts, cached form state) should not survive
// into the next one.
sessionStorage.clear();
localStorage.clear();
