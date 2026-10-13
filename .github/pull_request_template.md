## Syfte och scope
Beskriv ändringen och vilket verkligt användarproblem den löser. Koppla issue med `Refs` (undvik `Closes` innan leveransverifiering).

## Leveranskontrakt (ändra TODO; dessa fält granskas automatiskt)
Delivery target: TODO
Odelco impact: TODO
Backport plan: TODO
Database migration: TODO
External integration: TODO
Verification owner: TODO

Tillåtna värden:
- **Delivery target:** `main`, `odelco-staging` eller `production` (måste matcha PR:ens målgren).
- **Odelco impact:** `yes` eller `no`. `yes` betyder att Odelcos utfall kan ändras även om koden är generisk.
- **Backport plan:** vid `main` + `Odelco impact: yes`, ange länk till spårad staging-PR/issue, eller `not-needed: <motivering>`. För staging-PR skriv `direct-to-staging`. I övriga fall `not-applicable`.
- **Database migration** och **External integration:** `yes` eller `no`.
- **Verification owner:** person eller team som ansvarar för verklig acceptans (inte enbart CI).

## Tester före merge
- [ ] Rätt målgren och påverkan på andra tenants genomgången
- [ ] CI, lint, typer och relevanta regressionstester passerar
- [ ] Säkerhets-/pris-/inloggningsscenarier testade vid ändringar i sådana flöden
- [ ] Inga skarpa Geins-/kunddata-skrivningar som oavsiktlig testmetod

## Efter merge – leveransbevis (fylls i i issue/release, inte i förväg)
- [ ] Exakt commit/revision bekräftad i rätt staging/production
- [ ] Miljövariabler, migreringar och externa tjänster verifierade vid behov
- [ ] Verkligt användarflöde testat, inklusive negativa fall
- [ ] Ansvarig har dokumenterat resultat, datum och eventuell rollback
- [ ] För Odelco: backport-ärendet är stängt först efter stagingacceptans

**Statusord:** Kod klar → CI grön → Mergad → Driftsatt → Verifierad → Levererad.
