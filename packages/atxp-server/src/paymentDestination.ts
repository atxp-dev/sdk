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

export interface PaymentDestination {
  destination(fundingAmount: FundingAmount, buyerAddress: string): FundingDestination;
}

export class ChainPaymentDestination implements PaymentDestination {
  constructor(
    private readonly address: string,
    private readonly network: Network
  ) {}

  destination(_fundingAmount: FundingAmount, _buyerAddress: string): FundingDestination {
    return {
      destination: this.address,
      network: this.network
    };
  }
}