// Ink refuses to draw frames when it thinks it is running in CI.
//
// `is-in-ci` reads `CI`/`CONTINUOUS_INTEGRATION` once at import time, and Ink
// uses it to buffer every frame and flush only on unmount — the right call for
// a real program, whose redraws would otherwise fill a build log with escape
// codes. For this suite it means the fake stdout stays empty for the whole
// test and every assertion fails as `expected '' to contain ...`, which reads
// like a rendering bug rather than a mode switch. That is why the TUI tests
// passed locally and failed on GitHub Actions.
//
// The variable has to be *deleted*, not blanked: `is-in-ci` only ignores the
// literal strings "0" and "false", so `CI=""` still counts as CI. And it has
// to happen here, in a setup file, because the check runs when Ink is first
// imported — by the time a test file's imports are hoisted it is far too late.
delete process.env['CI'];
delete process.env['CONTINUOUS_INTEGRATION'];
