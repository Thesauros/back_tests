#!/bin/sh
# Runs every simulation of the pack again, prints the tables again, and compares each file with
# the one the pack holds, byte for byte. Node 18 or later; about two minutes.
#   cd reproduce && ./reproduce.sh
set -e
cd "$(dirname "$0")"

# <config>:<run folder of the pack>
RUNS="
base.alloc-a:base-allocator-set-a
base.alloc-a.measured:base-allocator-set-a-measured
base.alloc-strict:base-allocator-strict-set
base.alloc-b:base-allocator-set-b
base.alloc-b.measured:base-allocator-set-b-measured
base.public-a:base-public-rules-set-a
base.deployed:base-vault-as-deployed
ethereum.alloc-a:ethereum-allocator-set-a
ethereum.alloc-a.measured:ethereum-allocator-set-a-measured
ethereum.alloc-strict:ethereum-allocator-strict-set
ethereum.alloc-b:ethereum-allocator-set-b
ethereum.alloc-b.measured:ethereum-allocator-set-b-measured
ethereum.public-a:ethereum-public-rules-set-a
ethereum.deployed:ethereum-vault-as-deployed
"
PROGRAMME="alloc-a alloc-a.measured alloc-strict alloc-b alloc-b.measured public-a deployed"
SENSITIVITY="base.alloc-a base.alloc-a.no-rate-impact ethereum.alloc-a ethereum.alloc-a.no-rate-impact ethereum.alloc-a.no-fluid ethereum.alloc-a.no-fluid-no-spark"
FIRST="base.deployed base.wide base.wide-vaults-kept ethereum.deployed ethereum.wide ethereum.wide-vaults-kept base.wide.no-rate-impact ethereum.wide.no-rate-impact ethereum.wide.no-fluid ethereum.wide.no-fluid-no-spark"

for config in config.*.json; do
  echo "simulate $config"
  node simulate.js "$config" > /dev/null
done

failed=0
for pair in $RUNS; do
  config="config.${pair%%:*}.json"
  folder="${pair##*:}"
  network="${pair%%.*}"
  output=$(node -e "console.log(require('./$config').output)")
  for file in tangem-simulation-daily.csv tangem-simulation-rebalances.csv tangem-stress-tests.csv tangem-stress-timelines.csv; do
    cmp -s "data/tangem/$network/$output/$file" "../$folder/simulation/$file" || { echo "DIFFERS: $folder/simulation/$file"; failed=1; }
  done
done

for network in base ethereum; do
  configs=""
  for run in $PROGRAMME; do configs="$configs config.$network.$run.json"; done
  node figures.js "out=data/tangem/figures-$network.md" $configs "check=config.$network.alloc-a.fee10.json" > /dev/null
done
configs=""
for run in $SENSITIVITY; do configs="$configs config.$run.json"; done
node figures.js out=data/tangem/figures-sensitivity.md $configs > /dev/null
configs=""
for run in $FIRST; do configs="$configs config.$run.json"; done
node figures.js out=data/tangem/figures-first-programme.md $configs > /dev/null
for name in base ethereum sensitivity first-programme; do
  cmp -s "data/tangem/figures-$name.md" "../figures-$name.md" || { echo "DIFFERS: figures-$name.md"; failed=1; }
done

[ "$failed" = 0 ] && echo "Every simulation file and every table reproduces byte for byte."
exit "$failed"
