# HARNESS — demo za žiri (~3 min)

Sve brojke dole su izmerene, ne procenjene. Ako te pitaju „kako znaš" — odgovor je
u poslednjoj sekciji.

---

## 0. Otvaranje (20 s)

> „DeFi hakovi se ponavljaju. Isti bag, drugi protokol — callback koji nije zatvoren,
> zaokruživanje koje ide u pogrešnu stranu. HARNESS generiše Solidity kod u kome su ti
> napadi već zatvoreni, i uz njega generiše testove koji to dokazuju na pravom mainnet
> forku. Ne na mocku — na pravom Aave-u i pravom Morpho-u."

---

## 1. Generisanje (30 s)

**Klikni preset `Aave v3 ERC-4626 Vault`. Pokaži opcije sa strane.**

> „Biramo preset i podesimo opcije: kontrola pristupa, pauza, deposit cap, decimals
> offset. Kod se prepisuje dok kucaš."

**Klikni kroz tabove fajlova.**

> „Tri fajla odmah: ugovor, attack testovi, deploy skripta. Ovo nije LLM koji piše kod —
> ovo je deterministički generator. Isti ulaz uvek daje isti izlaz, i svaka opcija koja
> bi napravila nesiguran ugovor se odbija umesto da se generiše."

---

## 2. Audit (30 s)

**Klikni `Audit`.**

> „Audit prolazi kroz katalog od 18 nalaza, svaki vezan za konkretan incident sa linkom.
> Na generisanom kodu je sve zeleno — i to je poenta: pravilo koje se nikad ne okine
> izgleda isto kao pravilo koje radi."

**Obriši `using SafeERC20 for IERC20;` iz editora, pa opet klikni `Audit`.**

> „Zato smo svako pravilo mutaciono testirali. Sklonim jednu zaštitu — okine se tačno
> jedan nalaz, onaj pravi, i nijedan drugi."

*(Ovo je jak trenutak. Sačekaj sekundu da žiri vidi crveno.)*

---

## 3. Morpho — zašto fork, a ne mock (45 s) ⭐

**Prebaci preset na `Morpho Blue Vault`.**

> „Dodali smo i Morpho Blue. To nije Aave sa drugom adresom — Morpho ima tri zamke koje
> Aave nema. Najzanimljivija: Morpho prima i `assets` i `shares`, i tačno jedan mora biti
> nula."

> „Kad smo pustili testove na forku, pali su. Morpho pri ulogu konvertuje assets u shares
> zaokružujući **naniže**, a pri isplati nazad zaokružujući **naviše**. Znači ako
> proknjižiš iznos koji si tražio, vault misli da ima više nego što stvarno može da
> isplati — i poslednji čovek koji izlazi ne može da izađe. Transakcija puca **unutar
> Morpho ugovora**, ne u našem."

> „Taj bag ne postoji ni na jednom mocku. Našli smo ga samo zato što testovi idu na pravi
> mainnet. Popravka: knjižimo razliku koju izmerimo, ne iznos koji smo tražili."

---

## 4. Preuzimanje i pokretanje (30 s)

**Klikni `Download`.**

> „Dobijaš kompletan Foundry projekat: `setup.sh` povuče zavisnosti, `forge test` pokrene
> napade. Testirali smo iz čistog foldera — raspakuj, pokreni, prolazi."

**Ako imaš terminal spreman, pusti `forge test`. Ako ne, pokaži screenshot.**

> „Sedam testova po presetu, dvadeset jedan ukupno, svi zeleni na mainnet forku preko
> Tenderly-ja."

---

## 5. MCP (20 s)

> „I sve ovo je dostupno preko MCP servera — znači Claude ili bilo koji AI agent može da
> generiše i auditira ugovor direktno, bez browsera. Isti API koji koristi sajt."

---

## 6. Zatvaranje (15 s)

> „Da rezimiram: generator koji ne može da napravi nesiguran ugovor, audit čija su pravila
> dokazano funkcionalna, i testovi koji su nam našli pravi bag u pravom protokolu."

---

## Ako pitaju „kako znate da radi?"

| Tvrdnja | Dokaz |
|---|---|
| Testovi rade | 21/21 na mainnet forku, 7 po presetu |
| Generator ne pravi smeće | 196/288 kombinacija opcija prolazi, 92 odbijeno kao nesigurno |
| Kod se kompajlira | 16 Morpho varijanti, 0 warninga |
| Audit pravila stvarno rade | 9 pravila mutaciono testirano — svako se okine na svoju mutaciju i ni na jednu tuđu |
| Download radi | Čist unzip → `setup.sh` → `forge test` → prolazi |

## Ako pitaju „šta ne radi još?"

Budi iskren, to ostavlja bolji utisak nego izbegavanje:

> „Panel sa preporukama za parametre vaulta čita žive Aave podatke, pa za sada radi samo
> za Aave presete. Za Morpho treba da ga povežemo na stanje marketa — to je sledeći korak."

---

## Ako pitaju „šta ako promenim asset?"

Ovo je dobro pitanje da ti postave — imaš jak odgovor.

> „Zavisi od protokola, i baš to alat pokazuje.
>
> Na Aave-u promeniš asset i savetnik te prati sam — Aave rezervu identifikuje
> adresa tokena, jedan token je jedna rezerva. WETH: druge decimale, drugi cap,
> drugi APY, i preporuka za offset se menja jer zavisi od decimala.
>
> Na Morpho-u ne. Morpho market **nije** token — market je hash pet parametara:
> loan token, kolateral, oracle, IRM i LLTV. Isti USDC postoji u više Morpho
> marketa sa različitim oracle-om i različitim LLTV-om. Zato „promeni asset" na
> Morpho-u nije dobro definisana operacija — to znači „izaberi drugi market".
>
> Zato vault pinuje market u konstruktoru, a savetnik odbija da analizira ako
> asset nije loan token tog marketa. To je isti nalaz koji generator brani,
> MRPH-MKT-018. Da smo tiho analizirali neki drugi market, dali bismo ti brojke
> o marketu koji tvoj ugovor nikad ne dodirne."

**Ako pritisnu „a kako onda menjam Morpho market?":**

> „Konstruktor prima svih pet parametara, pa market biraš pri deployu. Ono što ne
> možeš je da ga promeniš posle — nema settera, i test `test_MarketParamsArePinned`
> to proverava."

*(Demo: prebaci asset na WETH dok si na Morpho presetu — dobiješ objašnjenje, ne
brojke. Odbijanje je funkcija, ne ograničenje.)*

## Tehnički detalji za potpitanja

- **Zašto nije LLM?** Determinizam. Generator je čista funkcija; isti ulaz → isti izlaz,
  i može da odbije nesiguran ulaz. LLM ne može da garantuje ni jedno ni drugo.
- **Odakle nalazi?** Svaki je vezan za konkretan incident — Code4rena, Sherlock, ili
  dokumentacija protokola. Linkovi su u samim komentarima generisanog testa.
- **Zašto Tenderly?** Treba nam archive node da bismo fiksirali blok. Bez fiksiranog bloka
  test koji je danas zelen sutra pukne bez ikakve promene u kodu.
- **Morpho market:** nije izmišljen — pronađen skeniranjem `CreateMarket` logova i rangiran
  po slobodnoj likvidnosti. WBTC/USDC, 86% LLTV.
