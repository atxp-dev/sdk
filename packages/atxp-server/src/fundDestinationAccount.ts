import { Currency, Network } from "@atxp/common";
import BigNumber from "bignumber.js";

export type FundingAmount = {
  amount: BigNumber;
  currency: Currency;
}

export type FundingDestination = {
  destination: string;
  network: Network;
}

export interface FundDestinationAccount {
  destination(fundingAmount: FundingAmount, buyerAddress: string): FundingDestination;
}

export class BaseFundDestinationAccount implements FundDestinationAccount {
  constructor(private readonly address: string) {}

  destination(_fundingAmount: FundingAmount, _buyerAddress: string): FundingDestination {
    return {
      destination: this.address,
      network: 'base'
    };
  }
}

export class SolanaFundDestinationAccount implements FundDestinationAccount {
  constructor(private readonly address: string) {}

  destination(_fundingAmount: FundingAmount, _buyerAddress: string): FundingDestination {
    return {
      destination: this.address,
      network: 'solana'
    };
  }
}