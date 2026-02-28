import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { ROUTER_ABI, ERC20_ABI } from '../abis';

// Decimals per token symbol
function decimalsFor(sym) {
  if (sym === 'USDC') return 6;
  if (sym === 'WBTC') return 8;
  return 18;
}

// Reusable token selector dropdown
function TokenDropdown({ value, onChange, tokens, placeholder = 'Search…' }) {
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState('');

  const filtered = tokens.filter(t =>
    t.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="token-dropdown-container">
      <button className="token-select-btn" onClick={() => { setOpen(o => !o); setSearch(''); }}>
        {value} <span style={{ fontSize: 10, opacity: 0.6 }}>▼</span>
      </button>

      {open && (
        <div className="token-dropdown">
          <input
            className="token-search"
            type="text"
            placeholder={placeholder}
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
          <div className="token-list">
            {filtered.map(t => (
              <div
                key={t}
                className={`token-item ${t === value ? 'active' : ''}`}
                onClick={() => { onChange(t); setOpen(false); }}
              >
                <span>{t}</span>
                <span className="token-dec">{decimalsFor(t)} dec</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Swap({ provider, signer, account, deployments }) {
  const tokens   = Object.keys(deployments.tokens);
  const [tokenIn,  setTokenIn]  = useState('USDC');
  const [tokenOut, setTokenOut] = useState('WBTC');
  const [amountIn,  setAmountIn]  = useState('');
  const [amountOut, setAmountOut] = useState('');
  const [balIn,  setBalIn]  = useState('0');
  const [balOut, setBalOut] = useState('0');
  const [slippage, setSlippage] = useState('0.5');
  const [status,  setStatus]  = useState('');
  const [loading, setLoading] = useState(false);

  // Fetch wallet balances
  const fetchBalances = useCallback(async () => {
    if (!provider || !account) return;
    const [cA, cB] = [
      new ethers.Contract(deployments.tokens[tokenIn],  ERC20_ABI, provider),
      new ethers.Contract(deployments.tokens[tokenOut], ERC20_ABI, provider),
    ];
    const [bA, bB] = await Promise.all([cA.balanceOf(account), cB.balanceOf(account)]);
    setBalIn(ethers.formatUnits(bA, decimalsFor(tokenIn)));
    setBalOut(ethers.formatUnits(bB, decimalsFor(tokenOut)));
  }, [provider, account, tokenIn, tokenOut, deployments]);

  useEffect(() => { fetchBalances(); }, [fetchBalances]);

  // Price quote with 500 ms debounce
  const fetchQuote = useCallback(async (val) => {
    if (!val || !provider || parseFloat(val) <= 0) { setAmountOut(''); return; }
    try {
      const router  = new ethers.Contract(deployments.router, ROUTER_ABI, provider);
      const decIn   = decimalsFor(tokenIn);
      const decOut  = decimalsFor(tokenOut);
      const parsed  = ethers.parseUnits(val, decIn);
      const path    = [deployments.tokens[tokenIn], deployments.tokens[tokenOut]];
      const amounts = await router.getAmountsOut(parsed, path);
      setAmountOut(ethers.formatUnits(amounts[1], decOut));
    } catch { setAmountOut(''); }
  }, [provider, tokenIn, tokenOut, deployments]);

  useEffect(() => {
    const id = setTimeout(() => fetchQuote(amountIn), 500);
    return () => clearTimeout(id);
  }, [amountIn, fetchQuote]);

  const handleSwap = async () => {
    if (!signer || !amountIn || !amountOut) {
      setStatus('Please connect your wallet and enter an amount.');
      return;
    }
    setLoading(true);
    setStatus('');
    try {
      const router   = new ethers.Contract(deployments.router, ROUTER_ABI, signer);
      const addrIn   = deployments.tokens[tokenIn];
      const addrOut  = deployments.tokens[tokenOut];
      const decIn    = decimalsFor(tokenIn);
      const decOut   = decimalsFor(tokenOut);
      const parsedIn = ethers.parseUnits(amountIn, decIn);
      const parsedOut= ethers.parseUnits(
        parseFloat(amountOut).toFixed(decOut), decOut
      );
      const bps    = BigInt(Math.floor(parseFloat(slippage) * 100));
      const minOut = parsedOut * (10000n - bps) / 10000n;

      // Approve if needed
      setStatus('Checking approval…');
      const tokenContract = new ethers.Contract(addrIn, ERC20_ABI, signer);
      const allowance     = await tokenContract.allowance(account, deployments.router);
      if (allowance < parsedIn) {
        setStatus('Approving token…');
        await (await tokenContract.approve(deployments.router, ethers.MaxUint256)).wait();
      }

      // Swap
      setStatus('Sending swap transaction…');
      const deadline = Math.floor(Date.now() / 1000) + 1200;
      const tx = await router.swapExactTokensForTokens(
        parsedIn, minOut,
        [addrIn, addrOut],
        account, deadline
      );
      await tx.wait();

      setStatus(`✅ Swapped ${amountIn} ${tokenIn} → ~${parseFloat(amountOut).toFixed(6)} ${tokenOut}`);
      setAmountIn('');
      setAmountOut('');
      fetchBalances();
    } catch (e) {
      setStatus(`❌ ${e.reason ?? e.shortMessage ?? e.message}`);
    }
    setLoading(false);
  };

  const handleFaucet = async (sym) => {
    if (!signer) { setStatus('Connect wallet first.'); return; }
    setLoading(true);
    try {
      const c  = new ethers.Contract(deployments.tokens[sym], ERC20_ABI, signer);
      const tx = await c.faucet(account);
      await tx.wait();
      setStatus(`✅ Claimed 1,000 ${sym} from faucet`);
      fetchBalances();
    } catch (e) {
      setStatus(`❌ ${e.reason ?? e.message}`);
    }
    setLoading(false);
  };

  const flipTokens = () => {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setAmountIn(amountOut);
    setAmountOut('');
  };

  const statusClass = status.startsWith('✅') ? 'success'
                    : status.startsWith('❌') ? 'error'
                    : 'info';

  return (
    <div className="swap-card card">
      <h2 className="card-title">Swap</h2>

      {/* Slippage */}
      <div className="slippage-row">
        <span>Slippage:</span>
        {['0.1', '0.5', '1.0'].map(s => (
          <button
            key={s}
            className={`slippage-btn ${slippage === s ? 'active' : ''}`}
            onClick={() => setSlippage(s)}
          >
            {s}%
          </button>
        ))}
      </div>

      {/* Pay */}
      <div className="token-box">
        <div className="token-box-header">
          <span>You Pay</span>
          <span className="balance" onClick={() => setAmountIn(balIn)}>
            Balance: {parseFloat(balIn).toFixed(4)}
            <button className="max-btn">MAX</button>
          </span>
        </div>
        <div className="token-box-body">
          <input
            className="amount-input"
            type="number"
            placeholder="0.0"
            value={amountIn}
            onChange={e => setAmountIn(e.target.value)}
          />
          <div className="token-select-section">
            <TokenDropdown value={tokenIn} onChange={setTokenIn} tokens={tokens} />
            <button className="faucet-btn" title={`Claim 1,000 ${tokenIn}`} onClick={() => handleFaucet(tokenIn)}>💧</button>
          </div>
        </div>
      </div>

      {/* Flip */}
      <div className="flip-row">
        <button className="flip-btn" onClick={flipTokens} title="Flip tokens">⇅</button>
      </div>

      {/* Receive */}
      <div className="token-box">
        <div className="token-box-header">
          <span>You Receive</span>
          <span className="balance">Balance: {parseFloat(balOut).toFixed(4)}</span>
        </div>
        <div className="token-box-body">
          <input
            className="amount-input"
            type="number"
            placeholder="0.0"
            value={amountOut ? parseFloat(amountOut).toFixed(6) : ''}
            readOnly
          />
          <div className="token-select-section">
            <TokenDropdown value={tokenOut} onChange={setTokenOut} tokens={tokens} />
            <button className="faucet-btn" title={`Claim 1,000 ${tokenOut}`} onClick={() => handleFaucet(tokenOut)}>💧</button>
          </div>
        </div>
      </div>

      {/* Rate */}
      {amountIn && amountOut && (
        <div className="rate-info">
          1 {tokenIn} ≈ {(parseFloat(amountOut) / parseFloat(amountIn)).toFixed(6)} {tokenOut}
        </div>
      )}

      <button
        className="action-btn"
        onClick={handleSwap}
        disabled={loading || !account}
      >
        {!account ? 'Connect Wallet' : loading ? 'Processing…' : 'Swap'}
      </button>

      {status && <div className={`status ${statusClass}`}>{status}</div>}
    </div>
  );
}
