import { Logger, Source } from '@atxp/common';
import { Network, Chain, Destination, PaymentRequestOption, DestinationMaker, ChainEnum } from '@atxp/common';

export class PassthroughDestinationMaker implements DestinationMaker {
  private network: Network;
  constructor(network: Network) {
    this.network = network;
  }

  async makeDestinations(option: PaymentRequestOption, _logger: Logger, _paymentRequestId: string, _sources: Source[]): Promise<Destination[]> {
    if (option.network !== this.network) {
      return [];
    }
    
    // Check if option.network is also a Chain by inspecting the ChainEnum values
    if ((Object.values(ChainEnum) as string[]).includes(option.network)) {
      // It's a chain, so return a single passthrough destination
      const destination: Destination = {
        chain: option.network as Chain,
        currency: option.currency,
        address: option.address,
        amount: option.amount
      };
      return [destination];
    }
    return [];
  }
}

