#!/usr/bin/env node
import { main } from "../dist/cli.js";

// [Intended] process.exit ではなく exitCode に入れる。exit は書き出し途中の stdout を
// 切り捨てるので、パイプの相手が JSON を読み切れないことがある。
process.exitCode = await main(process.argv.slice(2));
