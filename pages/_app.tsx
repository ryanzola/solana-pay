import '../styles/globals.css'
import type { AppProps } from 'next/app'
import Layout from '../components/Layout'
import Head from 'next/head'

// SOLANA!
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base'
import { clusterApiUrl } from '@solana/web3.js'
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets'

require('@solana/wallet-adapter-react-ui/styles.css');

function MyApp({ Component, pageProps }: AppProps) {
  // the network can be set to 'devnet', 'testmet', or 'mainnet-beta'
  const network = WalletAdapterNetwork.Devnet

  // provide a custom RPC endpoint
  const endpoint = clusterApiUrl(network)

  // @solana/wallet-adapter-wallets includes all the adapters but supports tree shaking and lazy loading --
  // Only the wallets you configure here will be compiled into your application, and only the dependencies
  // of wallets that your users connect to will be loaded.
  const wallets = [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter({ network })
  ]

  return ( 
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <Layout>
            <Head>
              <title>Cookies Inc</title>
            </Head>
            <Component {...pageProps} />
          </Layout>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}

export default MyApp
