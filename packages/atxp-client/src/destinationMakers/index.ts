import { Network, NetworkEnum, DestinationMaker, FetchLike, assertNever } from '@atxp/common';
import { ATXPDestinationMaker } from './atxpDestinationMaker.js';
import { PassthroughDestinationMaker } from './passthroughDestinationMaker.js';

export { ATXPDestinationMaker } from './atxpDestinationMaker.js';
export { PassthroughDestinationMaker } from './passthroughDestinationMaker.js';

export interface DestinationMakerFactoryConfig {
  atxpAccountsServer: string;
  fetchFn?: FetchLike;
}

export function createDestinationMakers(config: DestinationMakerFactoryConfig): Map<Network, DestinationMaker> {
  const { atxpAccountsServer, fetchFn = fetch } = config;
  
  // Build the map by exhaustively checking all Network values
  const makers = new Map<Network, DestinationMaker>();
  
  for (const network of Object.values(NetworkEnum)) {
    // Exhaustiveness check using switch with assertNever
    switch (network) {
      case NetworkEnum.Solana:
        makers.set(network, new PassthroughDestinationMaker(network));
        break;
      case NetworkEnum.Base:
        makers.set(network, new PassthroughDestinationMaker(network));
        break;
      case NetworkEnum.World:
        makers.set(network, new PassthroughDestinationMaker(network));
        break;
      case NetworkEnum.Polygon:
        makers.set(network, new PassthroughDestinationMaker(network));
        break;
      case NetworkEnum.BaseSepolia:
        makers.set(network, new PassthroughDestinationMaker(network));
        break;
      case NetworkEnum.WorldSepolia:
        makers.set(network, new PassthroughDestinationMaker(network));
        break;
      case NetworkEnum.ATXP:
        makers.set(network, new ATXPDestinationMaker(atxpAccountsServer, fetchFn));
        break;
      default:
        // This will cause a compilation error if a new Network is added but not handled above
        assertNever(network);
    }
  }
  
  return makers;
}

