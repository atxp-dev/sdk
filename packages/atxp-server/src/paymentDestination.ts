import { Currency, Network } from "@atxp/common";
import BigNumber from "bignumber.js";

export type FundingAmount = {
  amount: BigNumber;
  currency: Currency;
}

export type PaymentAddress = {
  destination: string;
  network: Network;
}

export interface PaymentDestination {
  destination(fundingAmount: FundingAmount, buyerAddress: string): PaymentAddress;
}

export class ChainPaymentDestination implements PaymentDestination {
  constructor(
    private readonly address: string,
    private readonly network: Network
  ) {}

  destination(_fundingAmount: FundingAmount, _buyerAddress: string): PaymentAddress {
    return {
      destination: this.address,
      network: this.network
    };
  }
}