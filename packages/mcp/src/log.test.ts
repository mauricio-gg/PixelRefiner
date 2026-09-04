import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "./log";

type Capture = {
	stderr: string[];
	stdout: string[];
};

const capture = (): Capture => {
	const stderr: string[] = [];
	const stdout: string[] = [];
	vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
		stderr.push(String(chunk));
		return true;
	});
	vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
		stdout.push(String(chunk));
		return true;
	});
	return { stderr, stdout };
};

const withEnv = (value: string | undefined): void => {
	if (value === undefined) {
		delete process.env.PIXEL_REFINER_LOG;
		return;
	}
	process.env.PIXEL_REFINER_LOG = value;
};

afterEach(() => {
	vi.restoreAllMocks();
	delete process.env.PIXEL_REFINER_LOG;
});

describe("createLogger", () => {
	it("既定は warn で、warn と error だけを stderr に書く", () => {
		const sink = capture();
		const log = createLogger();

		log.error("boom");
		log.warn("careful");
		log.info("fyi");
		log.debug("noise");

		expect(log.level).toBe("warn");
		expect(sink.stderr).toEqual([
			"[pixel-refiner] error boom\n",
			"[pixel-refiner] warn careful\n",
		]);
	});

	it("stdout には決して書かない", () => {
		const sink = capture();
		const log = createLogger("debug");

		log.error("e");
		log.warn("w");
		log.info("i");
		log.debug("d");

		expect(sink.stdout).toEqual([]);
		expect(sink.stderr).toHaveLength(4);
		expect(sink.stderr[3]).toBe("[pixel-refiner] debug d\n");
	});

	it("silent は何も書かない", () => {
		const sink = capture();
		const log = createLogger("silent");

		log.error("e");
		log.warn("w");

		expect(sink.stderr).toEqual([]);
	});

	it("引数が無いときは PIXEL_REFINER_LOG を読む", () => {
		withEnv("info");
		const sink = capture();

		const log = createLogger();
		log.info("hello");
		log.debug("hidden");

		expect(log.level).toBe("info");
		expect(sink.stderr).toEqual(["[pixel-refiner] info hello\n"]);
	});

	it("引数は環境変数より優先される", () => {
		withEnv("silent");
		const sink = capture();

		const log = createLogger("error");
		log.error("e");

		expect(log.level).toBe("error");
		expect(sink.stderr).toEqual(["[pixel-refiner] error e\n"]);
	});

	it("環境変数が未知の値なら既定の warn に落ちる", () => {
		withEnv("chatty");
		const sink = capture();

		const log = createLogger();
		log.warn("w");
		log.info("i");

		expect(log.level).toBe("warn");
		expect(sink.stderr).toEqual(["[pixel-refiner] warn w\n"]);
	});
});
