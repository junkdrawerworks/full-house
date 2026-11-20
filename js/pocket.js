// Extra rolls. Every game you win that counts for you (at a table of the tour, a quick game, the back room, or today's
// table's counted game) puts one in your pocket, which carries from game to game and holds as many as you win. None at a
// friend's table or at Two players. The pocket is progress.pocket.

// Whether extra rolls play any part in game `g`: everywhere but a friend's table and Two players.
export const pocketHere = g => !!g && g.kind !== 'friend' && g.kind !== 'two';

// Whether game `g`, won or not, puts an extra roll in the pocket. At today's table only the day's counted game does:
// another go there plays the same dice again, so it would be one for the asking.
export const earns = (g, won, counted = true) => !!won && pocketHere(g) && (g.kind !== 'day' || !!counted);

// The pocket as saved: a whole number, 0 or more. A save from before extra rolls has none, and so an empty pocket.
export const pocketFrom = n => (Number.isInteger(n) && n > 0 ? n : 0);
