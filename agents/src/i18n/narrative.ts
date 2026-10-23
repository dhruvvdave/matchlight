import type { Language } from '@matchlight/schema';

/**
 * Localised narrative templates (offline narrator + fallback when the LLM is slow).
 * Personas: analyst (dense, tactical), casual (plain, emotional, max one number),
 * for / against (favourite-club framing, still honest), player (follow one player).
 * Placeholders in {braces} are filled from Facts, so template lines are grounded by construction.
 */
export type Persona = 'analyst' | 'casual' | 'for' | 'against' | 'player';
export type NarrKey =
  | 'goal'
  | 'big_chance'
  | 'save'
  | 'woodwork'
  | 'yellow'
  | 'red'
  | 'sub'
  | 'shift_up'
  | 'shift_down'
  | 'momentum'
  | 'press_up'
  | 'press_down'
  | 'top_speed'
  | 'shot_speed'
  | 'ball_speed'
  | 'difficult_pass'
  | 'xg_swing'
  | 'possession'
  | 'tempo'
  | 'chaos'
  | 'brace'
  | 'hattrick'
  | 'passes50'
  | 'km10'
  | 'half_time'
  | 'full_time'
  | 'full_time_win'
  | 'full_time_loss'
  | 'full_time_draw'
  | 'player_update'
  | 'player_recap'
  | 'kickoff'
  | 'catchup';

type Catalogue = Partial<Record<NarrKey, Partial<Record<Persona, string[]>>>>;

const en: Catalogue = {
  goal: {
    analyst: [
      '{min} GOAL {team}: {player} finishes a {xg} xG chance. {score}.',
      '{player} scores for {team} at {min} ({xg} xG). {score}.',
    ],
    casual: [
      'GOAL! {player} scores for {team}! It’s {score}.',
      'What a moment! {player} finds the net and it’s {score}.',
    ],
    for: ['YES! {player} scores for us! It’s {score}!', 'GET IN! {player} delivers for your team: {score}!'],
    against: [
      '{team} score through {player}. {score}. Plenty of time to respond.',
      'Goal for {team}, {player} with the finish. {score}. Your side need a reply.',
    ],
    player: [
      '{player} SCORES! Your player makes it {score}.',
      'There it is! {player} finds the net: {score}.',
    ],
  },
  big_chance: {
    analyst: [
      '{min} Big chance {team}: {player}, {xg} xG, not converted.',
      '{player} wastes a {xg} xG opening for {team}.',
    ],
    casual: [
      'So close! {player} really should have scored there.',
      'Oh, how has that stayed out? {player} goes agonisingly close.',
    ],
    for: [
      'So close for us! {player} nearly had it.',
      'Agonising! {player} inches away from a goal for your team.',
    ],
    against: ['Let off! {player} goes close for {team}.', 'Phew. {player} misses a big one for {team}.'],
    player: ['{player} goes close! Big chance for your player.'],
  },
  save: {
    analyst: [
      '{min} Save: {player} denied from a {xg} xG chance.',
      'Big stop: {player}’s {xg} xG effort kept out.',
    ],
    casual: ['What a save! {player} is denied.', 'Brilliant goalkeeping, {player} can’t believe it.'],
    for: ['Denied! {player} so nearly scored for us.'],
    against: ['Huge save! {player} is kept out and your team survive.'],
    player: ['{player} forces a big save!'],
  },
  woodwork: {
    analyst: ['{min} Woodwork: {player} hits the frame from a {xg} xG chance.'],
    casual: ['Off the post! {player} is inches away!'],
  },
  yellow: {
    analyst: ['{min} Yellow card {player} ({team}): {n} bookings for {team} now.'],
    casual: ['Yellow card for {player}. Careful now.'],
    for: ['Booking for {player}, so we need to stay disciplined.'],
    against: ['{player} goes into the book for {team}.'],
  },
  red: {
    analyst: ['{min} RED CARD: {player} sent off, {team} down to {n}. Expect a structural reshuffle.'],
    casual: ['Red card! {player} is sent off and {team} are a player down.'],
    for: ['Disaster! {player} is sent off. We’re a player short now.'],
    against: ['Red card for {team}! {player} is off and your team have the extra player.'],
    player: ['Red card for {player}. A tough end to the afternoon.'],
  },
  sub: {
    analyst: ['{min} {team} change: {in} on, {out} off.'],
    casual: ['Fresh legs for {team}: {in} replaces {out}.'],
    for: ['Change for us: {in} comes on for {out}.'],
    against: ['{team} make a change: {in} for {out}.'],
  },
  shift_up: {
    analyst: [
      '{min} {team} switch {from} → {to} and push the press up.',
      'Tactical change: {team} from {from} to {to}, more aggressive without the ball.',
    ],
    casual: ['{team} are going for it: more attackers on and pressing high.'],
    for: ['The manager is rolling the dice: we’re going all out now!'],
    against: ['{team} are throwing bodies forward. Brace yourself.'],
  },
  shift_down: {
    analyst: ['{min} {team} drop into a {to} (from {from}), sitting deeper.'],
    casual: ['{team} are sitting back now, trying to protect what they have.'],
    for: ['We’re tightening up at the back to see this out.'],
    against: ['{team} are parking the bus. Patience needed.'],
  },
  momentum: {
    analyst: [
      'Momentum swing to {team}: index {from} → {to} in five minutes.',
      'Momentum has flipped toward {team} ({from} → {to}).',
    ],
    casual: ['You can feel it: {team} are on top now.', 'The game has turned. {team} have taken over.'],
    for: [
      'We’re turning the screw! The game is flowing our way.',
      'Your team are on top now. Keep it going!',
    ],
    against: [
      '{team} have the upper hand right now. Hold firm.',
      'It’s all {team} at the moment, so your side need to weather this.',
    ],
    player: ['The game is swinging to {team}.'],
  },
  press_up: {
    analyst: [
      '{team} pressing harder: PPDA {from} → {to}.',
      'Pressure shift: {team} PPDA {from} → {to}, winning it back higher.',
    ],
    casual: ['{team} are hunting the ball high up the pitch, like a pack chasing every pass.'],
    for: ['We’re pressing them into mistakes. Brilliant energy!'],
    against: ['{team} are pressing hard. Your team need to move the ball quicker.'],
  },
  press_down: {
    analyst: ['{team} press easing: PPDA {from} → {to}.'],
    casual: ['{team} have stopped chasing, saving their legs.'],
  },
  top_speed: {
    analyst: ['Top speed: {player} {speed} km/h, new match high.'],
    casual: ['{player} just hit {speed} km/h. That’s faster than most people cycle!'],
    for: ['Rocket! {player} clocks {speed} km/h for us.'],
    against: ['{player} is flying for {team}: {speed} km/h.'],
    player: ['{player} clocks {speed} km/h, the fastest of the match so far.'],
  },
  shot_speed: {
    analyst: ['{player}’s strike leaves the boot at {speed} km/h.'],
    casual: ['Thunderbolt! {player} hits that at {speed} km/h.'],
    player: ['{player} unleashes a {speed} km/h strike.'],
  },
  ball_speed: {
    analyst: ['Ball speed {speed} km/h on {player}’s pass.'],
    casual: ['{player} fizzes one across at {speed} km/h.'],
  },
  difficult_pass: {
    analyst: [
      'Pass of the half? {player}: difficulty {d}/10, {len} m.',
      '{player} completes a {d}/10 difficulty pass ({len} m).',
    ],
    casual: ['What a pass from {player}, threaded through the tiniest gap.'],
    for: ['Gorgeous ball from {player}! That’s class.'],
    against: ['Lovely pass from {player} for {team}, credit where it’s due.'],
    player: ['Your player in top form: {player} pulls off a {d}/10 pass.'],
  },
  xg_swing: {
    analyst: ['{team} have generated {xg} xG in the last 10 minutes.'],
    casual: ['{team} are knocking on the door, chance after chance.'],
    for: ['We’re camped in their half and the chances are coming!'],
    against: ['{team} are creating a lot. Your defence is under siege.'],
  },
  possession: {
    analyst: ['{team}: {poss}% possession over the last 10 minutes.'],
    casual: ['{team} are keeping the ball like it’s glued to their boots.'],
    for: ['We’ve got the ball and we’re not giving it back.'],
    against: ['{team} are hogging the ball. Your side are chasing shadows.'],
  },
  tempo: {
    analyst: ['Tempo spike: {tempo} on-ball actions per minute.'],
    casual: ['This has turned into end-to-end basketball!'],
  },
  chaos: {
    analyst: ['Control index down to {control}/100: transitions everywhere.'],
    casual: ['Total chaos out there, nobody can keep the ball!'],
  },
  brace: {
    analyst: ['{player} has a brace.'],
    casual: ['Two for {player}! What a day!'],
    for: ['A brace for {player}! What a player!'],
    player: ['That’s two! {player} has a brace.'],
  },
  hattrick: {
    analyst: ['Hat-trick: {player}.'],
    casual: ['HAT-TRICK for {player}! Someone grab the match ball!'],
    player: ['Hat-trick! {player} takes the match ball home.'],
  },
  passes50: {
    analyst: ['{player} reaches 50 completed passes.'],
    casual: ['{player} is running the show in midfield.'],
    player: ['Milestone: {player} has completed 50 passes.'],
  },
  km10: {
    analyst: ['{player} passes 10 km covered.'],
    casual: ['{player} has run further than a 10K race already!'],
    player: ['Engine! {player} has covered 10 km.'],
  },
  half_time: {
    analyst: ['Half-time: {score}. xG {hx}–{ax}.'],
    casual: ['Half-time! It’s {score}.'],
  },
  full_time: {
    analyst: ['Full-time: {score}. xG {hx}–{ax}.'],
    casual: ['Full-time! It finishes {score}.'],
  },
  full_time_win: {
    for: ['FULL-TIME! We win {score}! What a performance!'],
  },
  full_time_loss: {
    for: ['Full-time: {score}. A tough one, but we go again.'],
  },
  full_time_draw: {
    for: ['Full-time: {score}. A point for your team.'],
  },
  player_update: {
    player: [
      '{player} so far: {touches} touches, {passes} passes completed, {km} km covered, top speed {speed} km/h.',
    ],
    analyst: ['{player}: {touches} touches, {passes} passes, {km} km, rating {rating}.'],
  },
  player_recap: {
    player: ['{player}’s match: rating {rating}, {touches} touches, {km} km, top speed {speed} km/h.'],
  },
  kickoff: {
    analyst: ['Kick-off at {stadium}: {home} v {away}. Synthetic data feed live.'],
    casual: ['We’re under way at {stadium}! {home} v {away}.'],
  },
  catchup: {
    analyst: ['Joined at {min}: {home} {score} {away}.'],
    casual: ['You’ve joined at {min}. It’s {home} {score} {away}.'],
  },
};

const fr: Catalogue = {
  goal: {
    analyst: ['{min} BUT {team} : {player} conclut une occasion à {xg} xG. {score}.'],
    casual: ['BUUUT ! {player} marque pour {team} ! {score}.'],
    for: ['OUI ! {player} marque pour nous ! {score} !'],
    against: ['But de {team} par {player}. {score}. Il reste du temps pour réagir.'],
    player: ['{player} MARQUE ! Votre joueur fait {score}.'],
  },
  big_chance: {
    analyst: ['{min} Grosse occasion {team} : {player}, {xg} xG, non convertie.'],
    casual: ['Si proche ! {player} aurait dû marquer.'],
    for: ['Si proche pour nous ! {player} y était presque.'],
    against: ['Ouf ! {player} passe tout près pour {team}.'],
  },
  save: {
    analyst: ['{min} Arrêt : {player} repoussé sur une occasion à {xg} xG.'],
    casual: ['Quel arrêt ! {player} est stoppé.'],
  },
  woodwork: {
    analyst: ['{min} Montant : {player} trouve le cadre ({xg} xG).'],
    casual: ['Sur le poteau ! {player} à quelques centimètres !'],
  },
  yellow: {
    analyst: ['{min} Carton jaune {player} ({team}) : {n} avertissements pour {team}.'],
    casual: ['Carton jaune pour {player}. Attention maintenant.'],
  },
  red: {
    analyst: ['{min} CARTON ROUGE : {player} expulsé, {team} à {n}. Réorganisation attendue.'],
    casual: ['Carton rouge ! {player} est expulsé, {team} en infériorité.'],
    for: ['Catastrophe ! {player} est expulsé. Nous sommes en infériorité.'],
    against: ['Rouge pour {team} ! {player} sort, votre équipe a un joueur de plus.'],
  },
  sub: {
    analyst: ['{min} Changement {team} : {in} entre, {out} sort.'],
    casual: ['Du sang neuf pour {team} : {in} remplace {out}.'],
  },
  shift_up: {
    analyst: ['{min} {team} passe du {from} au {to} et monte son pressing.'],
    casual: ['{team} prend des risques : plus d’attaquants et un pressing haut.'],
    for: ['Le coach tente le tout pour le tout : on attaque !'],
    against: ['{team} jette ses forces vers l’avant. Accrochez-vous.'],
  },
  shift_down: {
    analyst: ['{min} {team} recule en {to} (depuis {from}).'],
    casual: ['{team} recule pour protéger son avance.'],
  },
  momentum: {
    analyst: ['Bascule de la dynamique vers {team} : indice {from} → {to} en cinq minutes.'],
    casual: ['On le sent : {team} a pris le dessus.'],
    for: ['On met la pression ! Le match tourne en notre faveur.'],
    against: ['{team} domine en ce moment. Il faut tenir.'],
  },
  press_up: {
    analyst: ['{team} presse plus fort : PPDA {from} → {to}.'],
    casual: ['{team} chasse le ballon très haut, comme une meute sur chaque passe.'],
    for: ['Notre pressing les pousse à la faute !'],
    against: ['{team} presse fort. Votre équipe doit jouer plus vite.'],
  },
  press_down: {
    analyst: ['Le pressing de {team} se relâche : PPDA {from} → {to}.'],
    casual: ['{team} ne court plus après le ballon.'],
  },
  top_speed: {
    analyst: ['Vitesse max : {player} {speed} km/h, record du match.'],
    casual: ['{player} vient d’atteindre {speed} km/h, plus vite qu’un cycliste !'],
    player: ['{player} pointe à {speed} km/h, le plus rapide du match.'],
  },
  shot_speed: {
    analyst: ['La frappe de {player} part à {speed} km/h.'],
    casual: ['Quelle frappe ! {player} à {speed} km/h.'],
  },
  ball_speed: {
    analyst: ['Ballon à {speed} km/h sur la passe de {player}.'],
    casual: ['{player} envoie une passe tendue à {speed} km/h.'],
  },
  difficult_pass: {
    analyst: ['{player} réussit une passe de difficulté {d}/10 ({len} m).'],
    casual: ['Quelle passe de {player}, glissée dans un trou de souris.'],
    player: ['Votre joueur au sommet : passe de difficulté {d}/10 pour {player}.'],
  },
  xg_swing: {
    analyst: ['{team} a généré {xg} xG sur les 10 dernières minutes.'],
    casual: ['{team} frappe à la porte, occasion après occasion.'],
  },
  possession: {
    analyst: ['{team} : {poss} % de possession sur 10 minutes.'],
    casual: ['{team} garde le ballon comme collé aux crampons.'],
  },
  tempo: { analyst: ['Pic de rythme : {tempo} actions par minute.'], casual: ['Ça va d’un but à l’autre !'] },
  chaos: {
    analyst: ['Indice de contrôle à {control}/100 : transitions partout.'],
    casual: ['C’est le chaos, personne ne garde le ballon !'],
  },
  brace: { analyst: ['Doublé pour {player}.'], casual: ['Et de deux pour {player} !'] },
  hattrick: { analyst: ['Triplé : {player}.'], casual: ['TRIPLÉ pour {player} !'] },
  passes50: {
    analyst: ['{player} atteint 50 passes réussies.'],
    casual: ['{player} dirige le jeu au milieu.'],
  },
  km10: {
    analyst: ['{player} dépasse 10 km parcourus.'],
    casual: ['{player} a déjà couru plus qu’un 10 km !'],
  },
  half_time: { analyst: ['Mi-temps : {score}. xG {hx}–{ax}.'], casual: ['Mi-temps ! {score}.'] },
  full_time: { analyst: ['Fin du match : {score}. xG {hx}–{ax}.'], casual: ['C’est terminé ! {score}.'] },
  full_time_win: { for: ['C’EST FINI ! Victoire {score} !'] },
  full_time_loss: { for: ['Fin du match : {score}. Dur, mais on repart.'] },
  full_time_draw: { for: ['Fin du match : {score}. Un point pour votre équipe.'] },
  player_update: {
    player: [
      '{player} : {touches} ballons touchés, {passes} passes réussies, {km} km, pointe à {speed} km/h.',
    ],
  },
  player_recap: {
    player: ['Le match de {player} : note {rating}, {touches} ballons, {km} km, pointe à {speed} km/h.'],
  },
  kickoff: {
    analyst: ['Coup d’envoi à {stadium} : {home} - {away}. Flux de données synthétiques en direct.'],
    casual: ['C’est parti à {stadium} ! {home} - {away}.'],
  },
  catchup: {
    analyst: ['Connexion à la {min} : {home} {score} {away}.'],
    casual: ['Vous nous rejoignez à la {min} : {home} {score} {away}.'],
  },
};

const es: Catalogue = {
  goal: {
    analyst: ['{min} GOL {team}: {player} define una ocasión de {xg} xG. {score}.'],
    casual: ['¡GOOOL! ¡{player} marca para {team}! {score}.'],
    for: ['¡SÍ! ¡{player} marca para nosotros! ¡{score}!'],
    against: ['Gol de {team}, obra de {player}. {score}. Hay tiempo para reaccionar.'],
    player: ['¡{player} MARCA! Tu jugador pone el {score}.'],
  },
  big_chance: {
    analyst: ['{min} Ocasión clara {team}: {player}, {xg} xG, sin gol.'],
    casual: ['¡Uy, casi! {player} tenía que marcar.'],
    for: ['¡Qué cerca para nosotros! {player} casi la mete.'],
    against: ['¡Nos salvamos! {player} rozó el gol para {team}.'],
  },
  save: {
    analyst: ['{min} Parada: {player} no puede con una ocasión de {xg} xG.'],
    casual: ['¡Paradón! {player} no lo puede creer.'],
  },
  woodwork: {
    analyst: ['{min} Palo: {player} toca el poste ({xg} xG).'],
    casual: ['¡Al palo! ¡{player} se queda a centímetros!'],
  },
  yellow: {
    analyst: ['{min} Amarilla para {player} ({team}): {team} ya suma {n} amonestaciones.'],
    casual: ['Tarjeta amarilla para {player}. Cuidado ahora.'],
  },
  red: {
    analyst: ['{min} ROJA: {player} expulsado, {team} se queda con {n}. Toca reorganizarse.'],
    casual: ['¡Roja! {player} se va expulsado y {team} juega con uno menos.'],
    for: ['¡Desastre! Expulsan a {player}. Jugamos con uno menos.'],
    against: ['¡Roja para {team}! {player} se va y tu equipo tiene uno más.'],
  },
  sub: {
    analyst: ['{min} Cambio en {team}: entra {in}, sale {out}.'],
    casual: ['Piernas frescas para {team}: {in} por {out}.'],
  },
  shift_up: {
    analyst: ['{min} {team} pasa del {from} al {to} y adelanta la presión.'],
    casual: ['{team} va a por todas: más delanteros y presión alta.'],
    for: ['¡El míster se la juega: vamos con todo!'],
    against: ['{team} se lanza al ataque. Agárrate.'],
  },
  shift_down: {
    analyst: ['{min} {team} se repliega en {to} (antes {from}).'],
    casual: ['{team} se echa atrás para proteger el resultado.'],
  },
  momentum: {
    analyst: ['El impulso cambia hacia {team}: índice {from} → {to} en cinco minutos.'],
    casual: ['Se nota: {team} manda ahora.'],
    for: ['¡Estamos apretando! El partido es nuestro.'],
    against: ['{team} domina ahora mismo. Hay que aguantar.'],
  },
  press_up: {
    analyst: ['{team} presiona más: PPDA {from} → {to}.'],
    casual: ['{team} persigue el balón muy arriba, como una jauría tras cada pase.'],
    for: ['¡Nuestra presión los está volviendo locos!'],
    against: ['{team} aprieta fuerte. Tu equipo debe mover el balón más rápido.'],
  },
  press_down: {
    analyst: ['La presión de {team} baja: PPDA {from} → {to}.'],
    casual: ['{team} ya no persigue el balón.'],
  },
  top_speed: {
    analyst: ['Velocidad máxima: {player} {speed} km/h, récord del partido.'],
    casual: ['¡{player} acaba de llegar a {speed} km/h, más rápido que una bici!'],
    player: ['{player} marca {speed} km/h, el más rápido del partido.'],
  },
  shot_speed: {
    analyst: ['El disparo de {player} sale a {speed} km/h.'],
    casual: ['¡Cañonazo! {player} le pega a {speed} km/h.'],
  },
  ball_speed: {
    analyst: ['Balón a {speed} km/h en el pase de {player}.'],
    casual: ['{player} manda un pase tenso a {speed} km/h.'],
  },
  difficult_pass: {
    analyst: ['{player} completa un pase de dificultad {d}/10 ({len} m).'],
    casual: ['¡Qué pase de {player}, por el ojo de una aguja!'],
    player: ['Tu jugador en su mejor versión: pase de dificultad {d}/10 de {player}.'],
  },
  xg_swing: {
    analyst: ['{team} ha generado {xg} xG en los últimos 10 minutos.'],
    casual: ['{team} está llamando a la puerta, ocasión tras ocasión.'],
  },
  possession: {
    analyst: ['{team}: {poss}% de posesión en los últimos 10 minutos.'],
    casual: ['{team} tiene el balón pegado a las botas.'],
  },
  tempo: { analyst: ['Pico de ritmo: {tempo} acciones por minuto.'], casual: ['¡Esto es ida y vuelta!'] },
  chaos: {
    analyst: ['Índice de control en {control}/100: transiciones por todos lados.'],
    casual: ['¡Caos total, nadie retiene el balón!'],
  },
  brace: { analyst: ['Doblete de {player}.'], casual: ['¡Dos de {player}!'] },
  hattrick: { analyst: ['Triplete: {player}.'], casual: ['¡TRIPLETE de {player}!'] },
  passes50: {
    analyst: ['{player} llega a 50 pases completados.'],
    casual: ['{player} maneja el centro del campo.'],
  },
  km10: {
    analyst: ['{player} supera los 10 km recorridos.'],
    casual: ['¡{player} ya ha corrido más que una carrera de 10K!'],
  },
  half_time: { analyst: ['Descanso: {score}. xG {hx}–{ax}.'], casual: ['¡Descanso! {score}.'] },
  full_time: { analyst: ['Final: {score}. xG {hx}–{ax}.'], casual: ['¡Final del partido! {score}.'] },
  full_time_win: { for: ['¡FINAL! ¡Ganamos {score}!'] },
  full_time_loss: { for: ['Final: {score}. Duele, pero volveremos.'] },
  full_time_draw: { for: ['Final: {score}. Un punto para tu equipo.'] },
  player_update: {
    player: ['{player}: {touches} toques, {passes} pases completados, {km} km, punta de {speed} km/h.'],
  },
  player_recap: {
    player: ['El partido de {player}: nota {rating}, {touches} toques, {km} km, punta de {speed} km/h.'],
  },
  kickoff: {
    analyst: ['Arranca el partido en {stadium}: {home} - {away}. Datos sintéticos en vivo.'],
    casual: ['¡Echa a rodar el balón en {stadium}! {home} - {away}.'],
  },
  catchup: {
    analyst: ['Conectado en el {min}: {home} {score} {away}.'],
    casual: ['Te unes en el {min}: {home} {score} {away}.'],
  },
};

const hi: Catalogue = {
  goal: {
    analyst: ['{min} गोल {team}: {player} ने {xg} xG का मौक़ा भुनाया। {score}।'],
    casual: ['गोल! {player} ने {team} के लिए गोल किया! स्कोर {score}।'],
    for: ['हाँ! {player} ने हमारे लिए गोल किया! {score}!'],
    against: ['{team} का गोल, {player} ने किया। {score}। अभी वापसी का समय है।'],
    player: ['{player} का गोल! आपके खिलाड़ी ने स्कोर {score} किया।'],
  },
  big_chance: {
    analyst: ['{min} बड़ा मौक़ा {team}: {player}, {xg} xG, गोल नहीं।'],
    casual: ['बहुत क़रीब! {player} को यह गोल करना चाहिए था।'],
    for: ['हमारे लिए बहुत क़रीब! {player} लगभग कर ही चुके थे।'],
    against: ['बच गए! {player} {team} के लिए क़रीब पहुँचे।'],
  },
  save: {
    analyst: ['{min} बचाव: {player} का {xg} xG वाला शॉट रोका गया।'],
    casual: ['शानदार बचाव! {player} रोक दिए गए।'],
  },
  woodwork: {
    analyst: ['{min} पोस्ट: {player} का शॉट फ़्रेम से टकराया ({xg} xG)।'],
    casual: ['पोस्ट से टकराया! {player} बाल-बाल चूके!'],
  },
  yellow: {
    analyst: ['{min} पीला कार्ड {player} ({team}): {team} के अब {n} कार्ड।'],
    casual: ['{player} को पीला कार्ड। अब संभलकर खेलना होगा।'],
  },
  red: {
    analyst: ['{min} लाल कार्ड: {player} बाहर, {team} के अब {n} खिलाड़ी। ढाँचे में बदलाव तय।'],
    casual: ['लाल कार्ड! {player} बाहर, {team} एक खिलाड़ी कम।'],
    for: ['बुरी ख़बर! {player} को लाल कार्ड। हम एक खिलाड़ी कम हैं।'],
    against: ['{team} को लाल कार्ड! {player} बाहर, आपकी टीम के पास एक खिलाड़ी ज़्यादा।'],
  },
  sub: {
    analyst: ['{min} {team} में बदलाव: {in} अंदर, {out} बाहर।'],
    casual: ['{team} में ताज़ा पैर: {out} की जगह {in}।'],
  },
  shift_up: {
    analyst: ['{min} {team} ने {from} से {to} किया और प्रेस ऊपर किया।'],
    casual: ['{team} अब पूरा ज़ोर लगा रही है: ज़्यादा अटैकर और ऊँचा प्रेस।'],
    for: ['कोच ने बड़ा दाँव खेला: अब हम पूरा अटैक करेंगे!'],
    against: ['{team} आगे बढ़ रही है। तैयार रहिए।'],
  },
  shift_down: {
    analyst: ['{min} {team} पीछे हटकर {to} में ({from} से)।'],
    casual: ['{team} अब पीछे रहकर बढ़त बचा रही है।'],
  },
  momentum: {
    analyst: ['मोमेंटम {team} की ओर: इंडेक्स पाँच मिनट में {from} → {to}।'],
    casual: ['माहौल बदल गया है: अब {team} हावी है।'],
    for: ['हम दबाव बना रहे हैं! मैच हमारी ओर झुक रहा है।'],
    against: ['अभी {team} भारी पड़ रही है। डटे रहना होगा।'],
  },
  press_up: {
    analyst: ['{team} का प्रेस तेज़: PPDA {from} → {to}।'],
    casual: ['{team} ऊपर जाकर गेंद छीन रही है, हर पास के पीछे भाग रही है।'],
    for: ['हमारी प्रेसिंग उनसे ग़लतियाँ करवा रही है!'],
    against: ['{team} ज़ोरदार प्रेस कर रही है। आपकी टीम को गेंद तेज़ घुमानी होगी।'],
  },
  press_down: {
    analyst: ['{team} का प्रेस धीमा: PPDA {from} → {to}।'],
    casual: ['{team} ने गेंद के पीछे भागना कम कर दिया है।'],
  },
  top_speed: {
    analyst: ['टॉप स्पीड: {player} {speed} km/h, मैच का नया रिकॉर्ड।'],
    casual: ['{player} ने {speed} km/h की रफ़्तार पकड़ी, साइकिल से भी तेज़!'],
    player: ['{player} ने {speed} km/h छुआ, मैच में अब तक सबसे तेज़।'],
  },
  shot_speed: {
    analyst: ['{player} का शॉट {speed} km/h की रफ़्तार से।'],
    casual: ['ज़बरदस्त शॉट! {player} ने {speed} km/h से मारा।'],
  },
  ball_speed: {
    analyst: ['{player} के पास पर गेंद की रफ़्तार {speed} km/h।'],
    casual: ['{player} का तेज़ पास, {speed} km/h।'],
  },
  difficult_pass: {
    analyst: ['{player} ने {d}/10 कठिनाई वाला पास पूरा किया ({len} m)।'],
    casual: ['{player} का कमाल का पास, सुई के छेद से निकाला!'],
    player: ['आपका खिलाड़ी शानदार फ़ॉर्म में: {player} का {d}/10 कठिनाई वाला पास।'],
  },
  xg_swing: {
    analyst: ['{team} ने पिछले 10 मिनट में {xg} xG बनाया।'],
    casual: ['{team} लगातार मौक़े बना रही है।'],
  },
  possession: {
    analyst: ['{team}: पिछले 10 मिनट में {poss}% पज़ेशन।'],
    casual: ['{team} ने गेंद अपने पास जमा रखी है।'],
  },
  tempo: {
    analyst: ['रफ़्तार में उछाल: {tempo} एक्शन प्रति मिनट।'],
    casual: ['खेल अब एक छोर से दूसरे छोर तक!'],
  },
  chaos: {
    analyst: ['कंट्रोल इंडेक्स {control}/100 पर: हर तरफ़ ट्रांज़िशन।'],
    casual: ['पूरी अफ़रा-तफ़री, कोई गेंद नहीं रख पा रहा!'],
  },
  brace: { analyst: ['{player} के दो गोल।'], casual: ['{player} का दूसरा गोल!'] },
  hattrick: { analyst: ['हैट-ट्रिक: {player}।'], casual: ['{player} की हैट-ट्रिक!'] },
  passes50: { analyst: ['{player} के 50 सफल पास पूरे।'], casual: ['{player} मिडफ़ील्ड पर राज कर रहे हैं।'] },
  km10: {
    analyst: ['{player} ने 10 km दौड़ पूरी की।'],
    casual: ['{player} अब तक 10K रेस से ज़्यादा दौड़ चुके हैं!'],
  },
  half_time: { analyst: ['हाफ़-टाइम: {score}। xG {hx}–{ax}।'], casual: ['हाफ़-टाइम! स्कोर {score}।'] },
  full_time: { analyst: ['फ़ुल-टाइम: {score}। xG {hx}–{ax}।'], casual: ['मैच ख़त्म! स्कोर {score}।'] },
  full_time_win: { for: ['मैच ख़त्म! हम {score} से जीते!'] },
  full_time_loss: { for: ['फ़ुल-टाइम: {score}। मुश्किल दिन, पर हम फिर लौटेंगे।'] },
  full_time_draw: { for: ['फ़ुल-टाइम: {score}। आपकी टीम को एक अंक।'] },
  player_update: {
    player: ['{player} अब तक: {touches} टच, {passes} सफल पास, {km} km, टॉप स्पीड {speed} km/h।'],
  },
  player_recap: {
    player: ['{player} का मैच: रेटिंग {rating}, {touches} टच, {km} km, टॉप स्पीड {speed} km/h।'],
  },
  kickoff: {
    analyst: ['{stadium} में किक-ऑफ़: {home} बनाम {away}। सिंथेटिक डेटा लाइव।'],
    casual: ['{stadium} में मैच शुरू! {home} बनाम {away}।'],
  },
  catchup: {
    analyst: ['{min} पर जुड़े: {home} {score} {away}।'],
    casual: ['आप {min} पर जुड़े हैं। {home} {score} {away}।'],
  },
};

const ar: Catalogue = {
  goal: {
    analyst: ['{min} هدف {team}: {player} يحوّل فرصة قيمتها {xg} xG. {score}.'],
    casual: ['هدف! {player} يسجل لـ{team}! النتيجة {score}.'],
    for: ['نعم! {player} يسجل لنا! {score}!'],
    against: ['هدف لـ{team} عبر {player}. {score}. ما زال هناك وقت للرد.'],
    player: ['{player} يسجل! لاعبك يجعلها {score}.'],
  },
  big_chance: {
    analyst: ['{min} فرصة كبيرة لـ{team}: {player}، {xg} xG، دون هدف.'],
    casual: ['قريبة جداً! كان على {player} أن يسجل.'],
    for: ['قريبة جداً لنا! {player} كاد يسجل.'],
    against: ['نجونا! {player} يقترب لـ{team}.'],
  },
  save: {
    analyst: ['{min} تصدٍّ: {player} يُحرم من فرصة قيمتها {xg} xG.'],
    casual: ['تصدٍّ رائع! {player} لا يصدق.'],
  },
  woodwork: {
    analyst: ['{min} القائم: تسديدة {player} ترتد من الإطار ({xg} xG).'],
    casual: ['في القائم! {player} على بعد سنتيمترات!'],
  },
  yellow: {
    analyst: ['{min} بطاقة صفراء لـ{player} ({team}): {n} إنذارات لـ{team} الآن.'],
    casual: ['بطاقة صفراء لـ{player}. عليه الحذر الآن.'],
  },
  red: {
    analyst: ['{min} بطاقة حمراء: طرد {player}، {team} بـ{n} لاعبين. إعادة ترتيب متوقعة.'],
    casual: ['بطاقة حمراء! طرد {player} و{team} بنقص عددي.'],
    for: ['كارثة! طرد {player}. نلعب بنقص عددي الآن.'],
    against: ['بطاقة حمراء لـ{team}! خروج {player} وفريقك بزيادة عددية.'],
  },
  sub: {
    analyst: ['{min} تبديل {team}: دخول {in} وخروج {out}.'],
    casual: ['دماء جديدة لـ{team}: {in} بدلاً من {out}.'],
  },
  shift_up: {
    analyst: ['{min} {team} يتحول من {from} إلى {to} ويرفع الضغط.'],
    casual: ['{team} يندفع للهجوم: مهاجمون أكثر وضغط عالٍ.'],
    for: ['المدرب يغامر: نهاجم بكل شيء الآن!'],
    against: ['{team} يرمي بثقله للأمام. استعدوا.'],
  },
  shift_down: {
    analyst: ['{min} {team} يتراجع إلى {to} (بدلاً من {from}).'],
    casual: ['{team} يتراجع لحماية النتيجة.'],
  },
  momentum: {
    analyst: ['تحوّل الزخم نحو {team}: المؤشر {from} → {to} خلال خمس دقائق.'],
    casual: ['الأمر واضح: {team} يسيطر الآن.'],
    for: ['نحن نضغط! المباراة تسير لصالحنا.'],
    against: ['{team} هو الأفضل الآن. يجب الصمود.'],
  },
  press_up: {
    analyst: ['{team} يضغط أكثر: PPDA {from} → {to}.'],
    casual: ['{team} يطارد الكرة في الأعلى كقطيع خلف كل تمريرة.'],
    for: ['ضغطنا يجبرهم على الأخطاء!'],
    against: ['{team} يضغط بقوة. على فريقك تمرير الكرة أسرع.'],
  },
  press_down: { analyst: ['ضغط {team} يخفّ: PPDA {from} → {to}.'], casual: ['{team} توقف عن مطاردة الكرة.'] },
  top_speed: {
    analyst: ['أعلى سرعة: {player} {speed} كم/س، رقم قياسي في المباراة.'],
    casual: ['{player} وصل إلى {speed} كم/س، أسرع من دراجة!'],
    player: ['{player} يسجل {speed} كم/س، الأسرع في المباراة حتى الآن.'],
  },
  shot_speed: {
    analyst: ['تسديدة {player} تنطلق بسرعة {speed} كم/س.'],
    casual: ['صاروخ! {player} يسدد بسرعة {speed} كم/س.'],
  },
  ball_speed: {
    analyst: ['سرعة الكرة {speed} كم/س في تمريرة {player}.'],
    casual: ['{player} يرسل تمريرة قوية بسرعة {speed} كم/س.'],
  },
  difficult_pass: {
    analyst: ['{player} ينجح في تمريرة صعوبتها {d}/10 ({len} م).'],
    casual: ['يا لها من تمريرة من {player}، من ثقب إبرة!'],
    player: ['لاعبك في أفضل حالاته: تمريرة صعوبتها {d}/10 من {player}.'],
  },
  xg_swing: {
    analyst: ['{team} صنع {xg} xG في آخر 10 دقائق.'],
    casual: ['{team} يطرق الباب بفرصة تلو الأخرى.'],
  },
  possession: {
    analyst: ['{team}: استحواذ {poss}% في آخر 10 دقائق.'],
    casual: ['{team} يحتفظ بالكرة وكأنها ملتصقة بقدميه.'],
  },
  tempo: {
    analyst: ['ارتفاع الإيقاع: {tempo} لمسة في الدقيقة.'],
    casual: ['المباراة أصبحت ذهاباً وإياباً!'],
  },
  chaos: {
    analyst: ['مؤشر السيطرة عند {control}/100: تحولات في كل مكان.'],
    casual: ['فوضى تامة، لا أحد يحتفظ بالكرة!'],
  },
  brace: { analyst: ['ثنائية لـ{player}.'], casual: ['الهدف الثاني لـ{player}!'] },
  hattrick: { analyst: ['هاتريك: {player}.'], casual: ['هاتريك لـ{player}!'] },
  passes50: { analyst: ['{player} يصل إلى 50 تمريرة ناجحة.'], casual: ['{player} يدير وسط الملعب.'] },
  km10: { analyst: ['{player} يتجاوز 10 كم.'], casual: ['{player} ركض أكثر من سباق 10 كم!'] },
  half_time: {
    analyst: ['نهاية الشوط الأول: {score}. xG {hx}–{ax}.'],
    casual: ['استراحة! النتيجة {score}.'],
  },
  full_time: { analyst: ['نهاية المباراة: {score}. xG {hx}–{ax}.'], casual: ['انتهت المباراة! {score}.'] },
  full_time_win: { for: ['انتهت! فزنا {score}!'] },
  full_time_loss: { for: ['نهاية المباراة: {score}. يوم صعب لكننا سنعود.'] },
  full_time_draw: { for: ['نهاية المباراة: {score}. نقطة لفريقك.'] },
  player_update: {
    player: ['{player} حتى الآن: {touches} لمسة، {passes} تمريرة ناجحة، {km} كم، أعلى سرعة {speed} كم/س.'],
  },
  player_recap: {
    player: ['مباراة {player}: التقييم {rating}، {touches} لمسة، {km} كم، أعلى سرعة {speed} كم/س.'],
  },
  kickoff: {
    analyst: ['انطلاق المباراة في {stadium}: {home} ضد {away}. بيانات اصطناعية مباشرة.'],
    casual: ['انطلقت المباراة في {stadium}! {home} ضد {away}.'],
  },
  catchup: {
    analyst: ['انضممت عند {min}: {home} {score} {away}.'],
    casual: ['انضممت عند {min}. {home} {score} {away}.'],
  },
};

export const NARRATIVE: Record<Language, Catalogue> = { en, fr, es, hi, ar };

const FALLBACK: Record<Persona, Persona[]> = {
  analyst: ['analyst', 'casual'],
  casual: ['casual', 'analyst'],
  for: ['for', 'casual', 'analyst'],
  against: ['against', 'casual', 'analyst'],
  player: ['player', 'casual', 'analyst'],
};

/** Pick a template: requested language & persona, falling back through personas, then English. */
export function pickTemplate(
  lang: Language,
  key: NarrKey,
  persona: Persona,
  salt: number,
): { tpl: string; lang: Language } | null {
  for (const l of [lang, 'en'] as Language[]) {
    for (const p of FALLBACK[persona]) {
      const list = NARRATIVE[l][key]?.[p];
      if (list?.length) return { tpl: list[salt % list.length], lang: l };
    }
  }
  return null;
}

export function fill(tpl: string, params: Record<string, string | number | undefined>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => {
    const v = params[k];
    return v === undefined || v === null ? '' : String(v);
  });
}
