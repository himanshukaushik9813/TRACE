/**
 * Plain-language definitions for the terms TRACE shows. One or two short
 * sentences each, written for someone who has never used DeFi. Used by <Term>.
 */
export const GLOSSARY = {
  wallet: { term: "Wallet", text: "A public blockchain address. Everything it has done on-chain is public, so TRACE can read it without any permission." },
  liquidity: { term: "Liquidity", text: "Tokens a wallet deposits into a trading pool so others can swap against them. In return it earns a share of the trading fees." },
  lpPosition: { term: "LP position", text: "One deposit of liquidity into a pool. On Uniswap V3 each position is its own token (an NFT) with its own price range." },
  priceRange: { term: "Price range", text: "The prices between which a position is active. Inside the range it earns fees; outside it earns nothing until the price comes back or the range is moved." },
  inRange: { term: "In range", text: "The current price is inside the position's range, so the position is active and earning fees." },
  feesCollected: { term: "Fees collected", text: "Trading fees the wallet has withdrawn from the position. Fees are earned only while the price is in range." },
  deposited: { term: "Deposited", text: "The tokens the wallet put into the position, as recorded on-chain." },
  impermanentLoss: { term: "Impermanent loss", text: "How much less the position is worth than simply holding the same tokens, caused by the price moving. It becomes permanent if you withdraw at that price." },
  strategy: { term: "Strategy", text: "A pattern in how the wallet manages its positions: how wide its ranges are, how often it moves them, when it collects fees. TRACE infers it from the evidence; it is never the wallet owner's confirmed intent." },
  confidence: { term: "Strategy confidence", text: "How well the strategy fits the on-chain evidence, from 0 to 100 %. It is a fit score, not a probability that the owner meant this." },
  evidence: { term: "On-chain evidence", text: "Real transactions on Sepolia that support a conclusion. Every one links to the block explorer so you can check it yourself." },
  backtest: { term: "Backtest", text: "Replaying real past trading to see how a strategy would have performed. TRACE only uses prices that were known at each moment (no look-ahead)." },
  observed: { term: "Observed", text: "What actually happened on-chain: the wallet's real ranges, replayed on real swaps." },
  simulated: { term: "Simulation", text: "A what-if: what a strategy would have done on the same real swaps. It did not happen on-chain." },
  buyHold: { term: "Buy and hold", text: "The comparison of just keeping the tokens (half and half by value) instead of providing liquidity." },
  passiveLp: { term: "Passive LP", text: "Comparison: keep the wallet's starting range and never touch it." },
  drawdown: { term: "Max drawdown", text: "The biggest fall from a high point to a later low point during the test. Smaller is less risky." },
  capitalUtilization: { term: "Capital utilization", text: "The share of the time the deposited money was actually earning fees, which only happens while the price is in range." },
  aqua: { term: "1inch Aqua", text: "A 1inch protocol that lets a wallet offer liquidity through a strategy while its tokens stay in the wallet. TRACE can recreate supported strategy rules on it." },
  aquaCompatibility: { term: "Aqua compatibility", text: "Which of the strategy's rules can be expressed as a 1inch Aqua order. Rules that cannot are listed, never silently dropped." },
  authorization: { term: "Authorization", text: "A free signature from your wallet that approves exactly this plan. The server checks it before anything can be sent. It costs no gas and moves no tokens." },
  worldId: { term: "World ID", text: "An optional proof that a unique human is approving the action. This server does not have World ID configured, so the wallet signature is the authorization." },
  approve: { term: "Approve", text: "A wallet transaction allowing the Aqua contract to use an exact amount of one token. TRACE never asks for unlimited approval." },
  ship: { term: "Ship", text: "The transaction that publishes your strategy to 1inch Aqua on Sepolia. Your tokens stay in your wallet until a trade actually fills." },
  receipt: { term: "Receipt", text: "The blockchain's record that a transaction was included and whether it succeeded. TRACE checks every receipt itself." },
  sepolia: { term: "Sepolia", text: "Ethereum's public test network. Its tokens have no real value, so it is safe to try things." },
  gas: { term: "Gas", text: "The network fee paid in (test) ETH to send a transaction. Signatures are free; transactions cost gas." },
  version: { term: "Strategy version", text: "Each analysis is saved as an unchangeable version. A change in evidence or interpretation always creates a new version." },
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;
