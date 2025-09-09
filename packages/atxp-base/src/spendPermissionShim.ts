import { Eip1193Provider, SpendPermission } from "./types";
import { createWalletClient, custom, encodeFunctionData } from 'viem';
import { base } from 'viem/chains';

/*
This shim replaces the Base Account SDK's requestSpendPermission and prepareSpendCallData functions with
new functions that are based on ERC20 approvals instead of Coinbase Spend Permissions.

The upside is that it will work with any Base wallet/connector, not just certain Coinbase app versions.

The downside is that it's a worse user experience (the user might not be familiar with ERC20 approvals,
and their wallet might not explain it to them), and worse security (rather than a bounded recurring limit,
the user needs to grant a single fixed amount up-front—renewing that amount requires a new approval).
*/

// TODO: this version of the shim will only work for the initial approval. we need logic that can conditionally
// require new approvals when the old one runs out. (this will require changing the API for this module, or at
// least introducting a new function)

// Minimal ERC20 ABI for approve and transferFrom functions
const ERC20_ABI = [
  {
    "constant": false,
    "inputs": [
        {
            "name": "_spender",
            "type": "address"
        },
        {
            "name": "_value",
            "type": "uint256"
        }
    ],
    "name": "approve",
    "outputs": [
        {
            "name": "",
            "type": "bool"
        }
    ],
    "payable": false,
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
      "constant": false,
      "inputs": [
          {
              "name": "_from",
              "type": "address"
          },
          {
              "name": "_to",
              "type": "address"
          },
          {
              "name": "_value",
              "type": "uint256"
          }
      ],
      "name": "transferFrom",
      "outputs": [
          {
              "name": "",
              "type": "bool"
          }
      ],
      "payable": false,
      "stateMutability": "nonpayable",
      "type": "function"
  }
] as const;

export async function requestSpendPermission(params: {
  account: string;
  spender: string;
  token: string;
  chainId: number;
  allowance: bigint;
  periodInDays: number; // this is ignored
  provider: Eip1193Provider;
}): Promise<SpendPermission> {
  if (params.chainId !== base.id) {
    throw new Error(`Chain ID ${params.chainId} is not supported`);
  }

  const client = createWalletClient({
    chain: base,
    transport: custom(params.provider)
  });
  
  // Use the client
  const hash = await client.sendTransaction({
    account: params.account as `0x${string}`,
    to: params.token as `0x${string}`,
    data: encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [params.spender as `0x${string}`, params.allowance]
    })
  });

  return {
    permission: {
      account: params.account,
      spender: params.spender,
      token: params.token,
      allowance: params.allowance.toString(),
      period: params.periodInDays * 24 * 60 * 60,
      start: Math.floor(Date.now() / 1000),
      end: Math.floor(Date.now() / 1000) + params.periodInDays * 24 * 60 * 60,
      salt: '0x0',
      extraData: '0x0'
    },
    signature: hash
  };
}

export async function prepareSpendCallData(params: {
  permission: SpendPermission;
  amount: bigint;
}): Promise<{ to: string; data: string; value: bigint }[]> {
  // this introduces an extra layer of indirection: user wallet -> ephemeral wallet -> receiver
  // but the reason for this is that we can't sign JWTs from the user wallet directly
  return [
    {
      to: params.permission.permission.token as `0x${string}`,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'transferFrom',
        args: [params.permission.permission.account as `0x${string}`, params.permission.permission.spender as `0x${string}`, params.amount]
      }),
      value: BigInt(0)
    }
  ]
}