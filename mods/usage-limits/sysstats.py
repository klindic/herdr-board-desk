"""Print CPU, memory and GPU load as JSON percentages: {"cpu": 25, "ram": 56, "gpu": 16}.

macOS: CPU from the kernel's load ticks over a short window, memory as Activity Monitor's
"Memory Used" (app memory + wired + compressed) from vm_stat, GPU from the IOAccelerator's
"Device Utilization %". Linux: CPU from /proc/stat, memory from /proc/meminfo, no GPU.
A value that cannot be read is null. No elevation needed.
"""

import ctypes
import json
import re
import subprocess
import sys
import time

WINDOW = 0.25


def mac_cpu_ticks():
    libc = ctypes.CDLL("/usr/lib/libSystem.dylib")
    libc.mach_host_self.restype = ctypes.c_uint
    info = (ctypes.c_uint * 4)()  # user, system, idle, nice
    count = ctypes.c_uint(4)
    if libc.host_statistics(libc.mach_host_self(), 3, ctypes.byref(info), ctypes.byref(count)) != 0:
        raise OSError("host_statistics failed")
    user, system, idle, nice = info
    return user + system + nice, user + system + idle + nice


def linux_cpu_ticks():
    with open("/proc/stat") as handle:
        values = [int(v) for v in handle.readline().split()[1:]]
    idle = values[3] + (values[4] if len(values) > 4 else 0)
    return sum(values) - idle, sum(values)


def cpu(ticks):
    busy1, total1 = ticks()
    time.sleep(WINDOW)
    busy2, total2 = ticks()
    return 100 * (busy2 - busy1) / max(1, total2 - total1)


def mac_ram():
    out = subprocess.run(["vm_stat"], capture_output=True, text=True, timeout=5).stdout
    page = int(re.search(r"page size of (\d+) bytes", out).group(1))
    pages = {k.strip(): int(v.strip().rstrip(".")) for k, v in re.findall(r"^([^:\n]+):\s+(\d+)\.?$", out, re.M)}
    total = int(subprocess.run(["sysctl", "-n", "hw.memsize"], capture_output=True, text=True, timeout=5).stdout)
    app = pages.get("Anonymous pages", 0) - pages.get("Pages purgeable", 0)
    used = (app + pages.get("Pages wired down", 0) + pages.get("Pages occupied by compressor", 0)) * page
    return 100 * used / total


def linux_ram():
    with open("/proc/meminfo") as handle:
        info = {k: int(v.split()[0]) for k, v in (line.split(":", 1) for line in handle)}
    return 100 * (info["MemTotal"] - info["MemAvailable"]) / info["MemTotal"]


def mac_gpu():
    out = subprocess.run(["ioreg", "-r", "-d", "1", "-c", "IOAccelerator"], capture_output=True, text=True, timeout=5).stdout
    values = [int(v) for v in re.findall(r'"Device Utilization %"=(\d+)', out)]
    return max(values) if values else None


def safe(read):
    try:
        value = read()
        return None if value is None else max(0, min(100, round(value)))
    except Exception:
        return None


def main():
    if sys.platform == "darwin":
        result = {"cpu": safe(lambda: cpu(mac_cpu_ticks)), "ram": safe(mac_ram), "gpu": safe(mac_gpu)}
    elif sys.platform.startswith("linux"):
        result = {"cpu": safe(lambda: cpu(linux_cpu_ticks)), "ram": safe(linux_ram), "gpu": None}
    else:
        result = {"cpu": None, "ram": None, "gpu": None}
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
