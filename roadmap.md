# Roadmap
- [x] Plan for both tracks
- [x] FirstWave UI: landing, room, board (local stand-in for the Spacetime backend)
- [x] Spacetime module source for FirstWave (user publishes it with the Spacetime CLI; it needs their login)
- [x] Spacetime module verified: type-checks against spacetimedb@2.14.1, 5 rule tests pass in SpacetimeDB's own test runtime
- [x] ScrabbleBot strategy file, fitted to the starter shown in the video (auction.onInsert / myRack.onUpdate)
- [ ] Wire the app to the live Maincloud database (blocked: user must run `spacetime publish` with their own login, then `spacetime generate`)
