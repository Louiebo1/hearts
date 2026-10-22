// Plays games with the app's RuleStrategy (no look-aheads) and prints every decision
// with the view it was made from, one JSON object per line.
import Foundation

func trickJSON(_ t: Trick) -> [String: Any] {
    var d: [String: Any] = ["leader": t.leader, "plays": t.plays.map { ["seat": $0.seat, "card": $0.card.id] }]
    if t.isComplete, let w = t.winner { d["winner"] = w }
    return d
}
func viewJSON(_ v: PlayerView) -> [String: Any] {
    ["seat": v.seat, "hand": v.hand.map(\.id), "legalPlays": v.legalPlays.map(\.id),
     "trick": trickJSON(v.currentTrick), "completedTricks": v.completedTricks.map(trickJSON),
     "heartsBroken": v.heartsBroken, "passDirection": v.passDirection.label,
     "passedCards": v.passedCards.map(\.id), "receivedCards": v.receivedCards.map(\.id),
     "scores": v.scores, "handPoints": v.handPoints, "handNumber": v.handNumber]
}
func emit(_ kind: String, _ v: PlayerView, _ choice: [Int]) {
    let data = try! JSONSerialization.data(withJSONObject: ["kind": kind, "view": viewJSON(v), "choice": choice])
    print(String(data: data, encoding: .utf8)!)
}

var rules = RuleStrategy()
rules.extras.subtract([.endgame, .passLookAhead])
let games = Int(CommandLine.arguments.dropFirst().first ?? "50")!
var rng = SplitMix64(state: 12345)
for _ in 0..<games {
    var game = HeartsGame(deck: Card.fullDeck.shuffled(using: &rng))
    while game.phase != .gameOver {
        switch game.phase {
        case .passing:
            let passes = (0..<4).map { seat -> [Card] in
                let v = game.view(for: seat); let p = rules.choosePass(v); emit("pass", v, p.map(\.id)); return p }
            for seat in 0..<4 { try! game.submitPass(seat: seat, cards: passes[seat]) }
        case .playing:
            let seat = game.turn!; let v = game.view(for: seat); let c = rules.choosePlay(v)
            emit("play", v, [c.id]); try! game.play(c, by: seat)
        case .trickComplete: try! game.collectTrick()
        case .moonChoice: try! game.chooseMoon(down: HeartsGame.shooterGoesDown(game.moonShooter!, scores: game.scores))
        case .handComplete: try! game.startNextHand(deck: Card.fullDeck.shuffled(using: &rng))
        case .gameOver: break
        }
    }
}
