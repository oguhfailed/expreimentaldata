import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { ROUTER_ABI, ERC20_ABI, PAIR_ABI, FACTORY_ABI } from '../abis';

function decimalsFor(sym) {
  if (sym === 'USDC') return 6;
  if (sym === 'WBTC') return 8;
  return 18;
}

function TokenDropdown({ value, onChange, tokens }) {
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState('');
  const filtered = tokens.filter(t => t.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="token-dropdown-container">
      <button className="token-select-btn" onClick={() => { setOpen(o => !o); setSearch(''); }}>
        {value} <span style={{ fontSize: 10, opacity: 0.6 }}>▼</span>
      </button>
      {open && (
        <div className="token-dropdown">
          <input className="token-search" type="text" placeholder="Search…" value={search}
            onChange={e => setSearch(e.target.value)} autoFocus />
          <div className="token-list">
            {filtered.map(t => (
              <div key={t} className={`token-item ${t === value ? 'active' : ''}`}
                onClick={() => { onChange(t); setOpen(false); }}>
                {t}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Liquidity({ provider, signer, account, deployments }) {
  const tokens = Object.keys(deployments.tokens);

  const [tokenA, setTokenA] = useState('USDC');
  const [tokenB, setTokenB] = useState('WBTC');
  const [amtA, setAmtA]     = useState('');
  const [amtB, setAmtB]     = useState('');
  const [balA, setBalA]     = useState('0');
  const [balB, setBalB]     = useState('0');
  const [lpBalance, setLpBalance]   = useState('0');
  const [lpToRemove, setLpToRemove] = useState('');
  const [reserves, setReserves]     = useState(null);   // { resA, resB }
  const [pairAddr, setPairAddr]     = useState(null);
  const [mode, setMode]     = useState('add');           // 'add' | 'remove'
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const refreshData = useCallback(async () => {
    if (!provider) return;
    const factory = new ethers.Contract(deployments.factory, FACTORY_ABI, provider);
    const addrA   = deployments.tokens[tokenA];
    const addrB   = deployments.tokens[tokenB];
    const cA      = new ethers.Contract(addrA, ERC20_ABI, provider);
    const cB      = new ethers.Contract(addrB, ERC20_ABI, provider);

    const [pair, bA, bB] = await Promise.all([
      factory.getPair(addrA, addrB),
      account ? cA.balanceOf(account) : Promise.resolve(0n),
      account ? cB.balanceOf(account) : Promise.resolve(0n),
    ]);

    setBalA(ethers.formatUnits(bA, decimalsFor(tokenA)));
    setBalB(ethers.formatUnits(bB, decimalsFor(tokenB)));
    setPairAddr(pair);

    if (pair && pair !== ethers.ZeroAddress) {
      const pairC  = new ethers.Contract(pair, PAIR_ABI, provider);
      const [res, token0, lpBal] = await Promise.all([
        pairC.getReserves(),
        pairC.token0(),
        account ? pairC.balanceOf(account) : Promise.resolve(0n),
      ]);
      const isAToken0 = token0.toLowerCase() === addrA.toLowerCase();
      setReserves({
        resA: ethers.formatUnits(isAToken0 ? res[0] : res[1], decimalsFor(tokenA)),
        resB: ethers.formatUnits(isAToken0 ? res[1] : res[0], decimalsFor(tokenB)),
      });
      setLpBalance(ethers.formatUnits(lpBal, 18));
    } else {
      setReserves(null);
      setLpBalance('0');
    }
  }, [provider, account, tokenA, tokenB, deployments]);

  useEffect(() => { refreshData(); }, [refreshData]);

  // Auto-calculate the other amount when pool exists
  const handleAmtA = (val) => {
    setAmtA(val);
    if (reserves && val && parseFloat(val) > 0) {
      const ratio = parseFloat(reserves.resB) / parseFloat(reserves.resA);
      setAmtB((parseFloat(val) * ratio).toFixed(decimalsFor(tokenB)));
    }
  };
  const handleAmtB = (val) => {
    setAmtB(val);
    if (reserves && val && parseFloat(val) > 0) {
      const ratio = parseFloat(reserves.resA) / parseFloat(reserves.resB);
      setAmtA((parseFloat(val) * ratio).toFixed(decimalsFor(tokenA)));
    }
  };

  const handleAdd = async () => {
    if (!signer || !amtA || !amtB) { setStatus('Enter amounts for both tokens.'); return; }
    setLoading(true); setStatus('');
    try {
      const router = new ethers.Contract(deployments.router, ROUTER_ABI, signer);
      const addrA  = deployments.tokens[tokenA];
      const addrB  = deployments.tokens[tokenB];
      const pA = ethers.parseUnits(amtA, decimalsFor(tokenA));
      const pB = ethers.parseUnits(amtB, decimalsFor(tokenB));
      const minA = pA * 95n / 100n;
      const minB = pB * 95n / 100n;
      const deadline = Math.floor(Date.now() / 1000) + 1200;

      setStatus('Approving tokens…');
      const [cA, cB] = [
        new ethers.Contract(addrA, ERC20_ABI, signer),
        new ethers.Contract(addrB, ERC20_ABI, signer),
      ];
      const [allowA, allowB] = await Promise.all([
        cA.allowance(account, deployments.router),
        cB.allowance(account, deployments.router),
      ]);
      if (allowA < pA) await (await cA.approve(deployments.router, ethers.MaxUint256)).wait();
      if (allowB < pB) await (await cB.approve(deployments.router, ethers.MaxUint256)).wait();

      setStatus('Adding liquidity…');
      await (await router.addLiquidity(addrA, addrB, pA, pB, minA, minB, account, deadline)).wait();

      setStatus(`✅ Added ${amtA} ${tokenA} + ${amtB} ${tokenB}`);
      setAmtA(''); setAmtB('');
      await refreshData();
    } catch (e) {
      setStatus(`❌ ${e.reason ?? e.shortMessage ?? e.message}`);
    }
    setLoading(false);
  };

  const handleRemove = async () => {
    if (!signer || !lpToRemove || parseFloat(lpToRemove) <= 0) {
      setStatus('Enter LP token amount to remove.'); return;
    }
    setLoading(true); setStatus('');
    try {
      const router  = new ethers.Contract(deployments.router, ROUTER_ABI, signer);
      const addrA   = deployments.tokens[tokenA];
      const addrB   = deployments.tokens[tokenB];
      const lpParsed = ethers.parseUnits(lpToRemove, 18);
      const deadline = Math.floor(Date.now() / 1000) + 1200;

      setStatus('Approving LP token…');
      const pairC  = new ethers.Contract(pairAddr, PAIR_ABI, signer);
      const lpAllow = await pairC.allowance(account, deployments.router);
      if (lpAllow < lpParsed) await (await pairC.approve(deployments.router, ethers.MaxUint256)).wait();

      setStatus('Removing liquidity…');
      await (await router.removeLiquidity(addrA, addrB, lpParsed, 0n, 0n, account, deadline)).wait();

      setStatus('✅ Liquidity removed successfully');
      setLpToRemove('');
      await refreshData();
    } catch (e) {
      setStatus(`❌ ${e.reason ?? e.shortMessage ?? e.message}`);
    }
    setLoading(false);
  };

  const statusClass = status.startsWith('✅') ? 'success'
                    : status.startsWith('❌') ? 'error'
                    : 'info';

  return (
    <div className="liquidity-card card">
      <h2 className="card-title">Liquidity</h2>

      {/* Mode toggle */}
      <div className="mode-toggle">
        <button className={mode === 'add'    ? 'active' : ''} onClick={() => setMode('add')}>Add</button>
        <button className={mode === 'remove' ? 'active' : ''} onClick={() => setMode('remove')}>Remove</button>
      </div>

      {/* Pair selector */}
      <div className="pair-selector">
        <TokenDropdown value={tokenA} onChange={v => { setTokenA(v); setAmtA(''); setAmtB(''); }} tokens={tokens} />
        <span className="pair-sep">/</span>
        <TokenDropdown value={tokenB} onChange={v => { setTokenB(v); setAmtA(''); setAmtB(''); }} tokens={tokens} />
      </div>

      {/* Pool info */}
      {reserves ? (
        <div className="pool-info">
          <div className="pool-info-row"><span>Pool {tokenA}</span><span>{parseFloat(reserves.resA).toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></div>
          <div className="pool-info-row"><span>Pool {tokenB}</span><span>{parseFloat(reserves.resB).toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></div>
          <div className="pool-info-row"><span>Your LP tokens</span><span>{parseFloat(lpBalance).toFixed(6)}</span></div>
        </div>
      ) : pairAddr === ethers.ZeroAddress ? (
        <div className="pool-info new-pool">⚡ This will create a new pool — you set the initial price.</div>
      ) : null}

      {/* Add mode */}
      {mode === 'add' && (
        <>
          <div className="token-box">
            <div className="token-box-header">
              <span>{tokenA}</span>
              <span className="balance" onClick={() => handleAmtA(balA)}>
                Balance: {parseFloat(balA).toFixed(4)}
                <button className="max-btn">MAX</button>
              </span>
            </div>
            <input className="amount-input" type="number" placeholder="0.0"
              value={amtA} onChange={e => handleAmtA(e.target.value)} />
          </div>

          <div className="plus-sign">+</div>

          <div className="token-box">
            <div className="token-box-header">
              <span>{tokenB}</span>
              <span className="balance" onClick={() => handleAmtB(balB)}>
                Balance: {parseFloat(balB).toFixed(4)}
                <button className="max-btn">MAX</button>
              </span>
            </div>
            <input className="amount-input" type="number" placeholder="0.0"
              value={amtB} onChange={e => handleAmtB(e.target.value)} />
          </div>

          <button className="action-btn" onClick={handleAdd} disabled={loading || !account}>
            {!account ? 'Connect Wallet' : loading ? 'Processing…' : 'Add Liquidity'}
          </button>
        </>
      )}

      {/* Remove mode */}
      {mode === 'remove' && (
        <>
          <div className="token-box">
            <div className="token-box-header">
              <span>LP Tokens to burn</span>
              <span className="balance" onClick={() => setLpToRemove(lpBalance)}>
                Balance: {parseFloat(lpBalance).toFixed(6)}
                <button className="max-btn">MAX</button>
              </span>
            </div>
            <input className="amount-input" type="number" placeholder="0.0"
              value={lpToRemove} onChange={e => setLpToRemove(e.target.value)} />
          </div>

          <button
            className="action-btn"
            onClick={handleRemove}
            disabled={loading || !account || parseFloat(lpBalance) === 0}
          >
            {!account ? 'Connect Wallet' : loading ? 'Processing…' : 'Remove Liquidity'}
          </button>
        </>
      )}

      {status && <div className={`status ${statusClass}`}>{status}</div>}
    </div>
  );
}
