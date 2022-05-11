import { createTransferCheckedInstruction, getAssociatedTokenAddress, getMint, getOrCreateAssociatedTokenAccount } from "@solana/spl-token"
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base"
import { clusterApiUrl, Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js"
import { NextApiRequest, NextApiResponse } from "next"
import { couponAddress, shopAddress, usdcAddress } from "../../lib/addresses"
import calculatePrice from "../../lib/calculatePrice"
import base58 from 'bs58';

export type MakeTransactionInputData = {
  account: string,
}

type MakeTransactionGetResponse = {
  label: string,
  icon: string,
}

export type MakeTransactionOutputData = {
  transaction: string,
  message: string,
}

type ErrorOutput = {
  error: string
}

function get(res: NextApiResponse<MakeTransactionGetResponse>) {
  res.status(200).json({
    label: "Cookies Inc",
    icon: "https://freesvg.org/img/1370962427.png",
  })
}

async function post(
  req: NextApiRequest,
  res: NextApiResponse<MakeTransactionOutputData | ErrorOutput>
) {
  try {
    // pass the selected items in the query
    // calculate the expected cost
    const amount = calculatePrice(req.query)
    if(amount.toNumber() === 0) {
      res.status(400).json({ error: "Can't checkout with charge of 0"})
      return
    }

    // pass the reference to use in the query
    const { reference } = req.query
    if(!reference) {
      res.status(400).json({ error: "No reference provided" })
      return
    }

    // pass the buyers public key in JSON body
    const { account } = req.body as MakeTransactionInputData
    if(!account) {
      res.status(400).json({ error: "No account provided" })
      return
    }

    // get the shop private key from .eng
    // this is the same as in the scrop
    const shopPrivateKey = process.env.SHOP_PRIVATE_KEY as string
    if(!shopPrivateKey) {
      res.status(500).json({ error: "Shop private key not available"})
      return
    }
    const shopKeypair = Keypair.fromSecretKey(base58.decode(shopPrivateKey))

    const buyerPublicKey = new PublicKey(account)
    const shopPublicKey = shopAddress

    const network = WalletAdapterNetwork.Devnet
    const endpoint = clusterApiUrl(network)
    const connection = new Connection(endpoint)

    // get the buyer and seller coupon token accounts
    // if buyer account does not exist, create it (this costs SOL) as the shop account
    const buyerCouponAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      shopKeypair,   // shop pays the fee to create it
      couponAddress,  // which token the account is for
      buyerPublicKey, // who the token account belongs to (the buyer)
    )

    const shopCouponAddress = await getAssociatedTokenAddress(couponAddress, shopPublicKey)

    // if the buyer has at least 5 coupons, they can use them to get a discount
    const buyerGetsCouponDiscount = buyerCouponAccount.amount >= 5

    // get details about the USDC token
    const usdcMint = await getMint(connection, usdcAddress)
    // get the buyers USDC token account address
    const buyersUsdcAddress = await getAssociatedTokenAddress(usdcAddress, buyerPublicKey)
    // get the shops USDC token account address
    const shopUsdcAddress = await getAssociatedTokenAddress(usdcAddress, shopPublicKey)

    const { blockhash } = await (connection.getLatestBlockhash('finalized'))

    const transaction = new Transaction({
      recentBlockhash: blockhash,
      // the buyer pays the transaction fee
      feePayer: buyerPublicKey
    })

    const amountToPay = buyerGetsCouponDiscount ? amount.dividedBy(2) : amount

    // create the insttruction to send USDC from the buyer to the shop
    const transferInstruction = createTransferCheckedInstruction(
      buyersUsdcAddress,                              // source
      usdcAddress,                                    // mint (token address)
      shopUsdcAddress,                                // destination
      buyerPublicKey,                                 // owner of source address
      amountToPay.toNumber() * (10 ** usdcMint.decimals),  // amount to transfer ( in units of USDC token)
      usdcMint.decimals,                              //decimals of the USDC token
    )

    // add the reference to the instruction as a key
    // this transaction is returned when querying for the reference
    transferInstruction.keys.push({
      pubkey: new PublicKey(reference),
      isSigner: false,
      isWritable: false,
    })

    // create the instruction to send the coupon from the shop to the buyer
    // const couponInstruction = createTransferCheckedInstruction(
    //   shopCouponAddress,    // source account (coupon)
    //   couponAddress,        // token address (coupon)
    //   buyerCouponAccount,   // destination account (coupon)
    //   shopPublicKey,        // owner of source account
    //   1,                    // amount to transfer
    //   0,                    // decimals of the token
    // )

    
    const couponInstruction = buyerGetsCouponDiscount ? 
      // the coupon instruction is to send 5 coupons from the buyer to the shop
      createTransferCheckedInstruction(
        buyerCouponAccount.address,   // source account (coupons)
        couponAddress,                // token address (coupons)
        shopCouponAddress,            // destination account (coupons)
        buyerPublicKey,               // owner of the source account
        5,                            // amount to transfer
        0                             // decimals of the token
      ) :
      // the coupon instruction is to send 1 coupon from the shop to the buyer
      createTransferCheckedInstruction(
        shopCouponAddress,            // source account (coupon)
        couponAddress,                // token address (coupon)
        buyerCouponAccount.address,   // destination account
        shopPublicKey,                // owner of source account
        1,                            // amount to transfer
        0                             // decimals of the token
      )
    
    // add the shop as a signer to the coupon instruction
    // if the shop is sending a coupon, it already will be a signer
    // but if the buyer is sending the coupons, the shop wont be a
    // signer automatically. it's useful security to have the shop
    // sign the transaction
    couponInstruction.keys.push({
      pubkey: shopPublicKey,
      isSigner: true,
      isWritable: false
    })

    // add both instructions to the transaction
    transaction.add(transferInstruction, couponInstruction)

    // sign the transaction as the shop.
    // this is required to transfer the coupon
    // the shop must partial sign because the transfer instruction still requires the user
    transaction.partialSign(shopKeypair)

    // serialize the transaction and convert to base64 to return it
    const serializedTransaction = transaction.serialize({
      // will need the buyer to sign this transaction after its returned to them
      requireAllSignatures: false
    })
    const base64 = serializedTransaction.toString('base64')

    // @TODO insert into database: reference, amount

    const message = buyerGetsCouponDiscount ? "50% Discount! 🍪" : "Thanks for your order! 🍪"

    // return the serialized transaction
    res.status(200).json({
      transaction: base64,
      message: message
    })
  } catch(err) {
    console.error(err)
    res.status(500).json({ error: "error creating transaction", })
    return
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<MakeTransactionGetResponse | MakeTransactionOutputData | ErrorOutput>
) {
  if(req.method === "GET") {
    return get(res)
  } else if(req.method === "POST") {
    return await post(req, res)
  } else {
    return res.status(405).json({ error: "Method not allowed"})
  }
}