import { Eip1193Provider, SpendPermission } from "./types.js";
import { createWalletClient, custom, encodeFunctionData } from 'viem';
import { getWorldChainByChainId } from '@atxp/client';

/*
This shim replaces spend permission functionality with ERC20 approvals for World Chain.
This approach will work with any World Chain wallet/connector that supports ERC20 approvals.

The implementation is based on the Base shim but adapted for World Chain networks.
*/

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
  chainId: number; // World Chain mainnet (480) or sepolia (4801)
  allowance: bigint;
  periodInDays: number; // this is ignored in the shim implementation
  provider: Eip1193Provider;
}): Promise<SpendPermission> {
  // Validate chain ID and get chain config
  let chainConfig;
  try {
    chainConfig = getWorldChainByChainId(params.chainId);
  } catch (error) {
    throw new Error(`Chain ID ${params.chainId} is not supported. ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  const client = createWalletClient({
    chain: chainConfig,
    transport: custom(params.provider)
  });

  // Send ERC20 approve transaction
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
  // Creates transferFrom call data to move tokens from user wallet to ephemeral wallet
  return [
    {
      to: params.permission.permission.token as `0x${string}`,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'transferFrom',
        args: [
          params.permission.permission.account as `0x${string}`,
          params.permission.permission.spender as `0x${string}`,
          params.amount
        ]
      }),
      value: BigInt(0)
    }
  ];
}