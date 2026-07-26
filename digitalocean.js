$(document).ready(async function () {
    let do_api_keys = $('#digitalocean-data').html().trim().split("\n").map(s => s.trim()).filter(Boolean);
    const ips = {};

    window.doStats = { active: 0, error: 0, locked: 0 };
    window.doTotalDroplets = 0;
    window.doDropletIps = new Set();
    window.doHighCpu = 0;
    window.doPostsToday = 0;

    const localDomains = (getcache_localstorage('cookie_localdata_data') || '').trim().split('\n').map(s => s.trim()).filter(Boolean);

    await Promise.all(localDomains.map(async (domain) => {
        try {
            const ipAddr = await getIpDomain('http://' + domain);

            if (!ipAddr) return;

            if (!ips[ipAddr]) {
                ips[ipAddr] = [];
            }

            if (!ips[ipAddr].includes(domain)) {
                ips[ipAddr].push(domain);
            }
        } catch {}
    }));
	window.localdata_ips = ips;

    await Promise.all(do_api_keys.map(async (keys, i) => {
        let dts = await digitalocean_account(keys);

        if (!dts || dts.status === false || !dts.account) {

            window.doStats.error++;

            let htm = `
            <div class="col-md-6 mb-3">
                <div class="card h-100">
                    <div class="card-header d-flex justify-content-between align-items-center">
                        <h5>Accounts #${i}</h5>
                        <div class="alert alert-danger" role="alert">Error</div>
                    </div>
                <div class="card-body">
                    <p>API Key: ${keys}</p>
                    <p>${dts?.message || 'Unknown Error'}</p>
                </div>
                    <div class="card-footer d-flex justify-content-between">
                        <span>Balance: -</span>
                        <span>Droplets: -</span>
                    </div>
                </div>
            </div>`;

            $('<div>').html(htm).contents().addClass('card-append-anim').appendTo('#digitalocean-accounts');

            return;
        }

        let data = dts.account;

        window.doStats.active++;

        let badge = {
            active: 'success',
            warning: 'warning',
            locked: 'danger'
        }[data.status] || 'secondary';

        if( data.status == 'locked' ){
	        window.doStats.locked++;
	        let htm = `
	        <div class="col-md-6 mb-3">
	            <div class="card h-100">
	                <div class="card-header d-flex justify-content-between align-items-center">
	                    <h5>Accounts #${i}</h5>
                        <div class="alert alert-${badge}" role="alert">Locked</div>
	                </div>
                <div class="card-body">
                    <p>Email: ${data.email}</p>
                    <p>${data.status_message || 'Pokoknya Locked 😋' }</p>
                </div>
	                <div class="card-footer d-flex justify-content-between">
	                    <span>Balance: -</span>
	                    <span>Limit: -</span>
	                </div>
	            </div>
	        </div>`;
	        $('<div>').html(htm).contents().addClass('card-append-anim').appendTo('#digitalocean-accounts');
        }else{
            let [billing, droplets] = await Promise.all([
                digitalocean_balance(keys),
                digitalocean_droplets(keys)
            ]);
            window.doTotalDroplets += (droplets.meta?.total || 0);
/*
            let dropletList = '';
            if (droplets.droplets?.length) {
                droplets.droplets.forEach(d => {
                	if( d.networks.v4[0].ip_address === false || d.networks.v4[0].ip_address === null || d.networks.v4[0].ip_address === '' || d.networks.v4[0].ip_address.length == 0 ){ return; }
                	let linkednot = window.localdata_ips[d.networks.v4[0].ip_address] ? `<span class="text-success" data-bs-toggle="tooltip" data-bs-placement="top" data-bs-title="${window.localdata_ips[d.networks.v4[0].ip_address]}">Linked</span>` : '<span class="text-danger">Not Linked</span>';
                	let ipv = `<a class="link-body-emphasis" href="https://${d.networks.v4[0].ip_address}:8443/" target="_blank">${d.networks.v4[0].ip_address}</a>`;

                	let statusd = '';
					if( d.status == 'active' ){
						statusd = '<span class="text-success">Active</span>';
					} else if( d.status == 'off' ){
						statusd = `<a class="text-warning" href="#" onClick="turnOn(this, '${d.id}', '${keys}')">${d.status}</a>`;
					}else{
						statusd = `<span class="text-warning">${d.status}</a>`;
					}

                    let metrics = await droplet_metrics(d, keys);

                    let lastCpu = metrics?.cpu?.slice(-1)[0];
                    let lastMem = metrics?.memory?.slice(-1)[0];

                    let metrics_cpu = lastCpu?.value ?? 'N/A';
                    let metrics_memory = lastMem?.percent ?? 'N/A';
                    let metrics_bandwidth = metrics?.bandwidth ?? 'N/A';

                    dropletList += `<li class="list-group-item list-group-item-action list-group-item-primary pt-1 pb-1 d-flex align-items-center">
                        <div class="flex-grow-1">
                            <div>[<span class="sizeslug">${d.size_slug}</span>] ${ipv}</div>
                            <div class="text-muted" data-metrics="${d.id}">cpu: ${metrics_cpu} | memory : ${metrics_memory} | bandwith : ${metrics_bandwidth}</div>
                        </div>
                        <div class="me-3 text-nowrap">[${linkednot}] [<span class="text-success">${statusd}</span>]</div>
                    	<div class="ms-auto text-end"><a href="#" class="text-warning" onClick="resizeDropletFlow(this, '${keys}', '${d.id}')">Upgrade</a></div>
                    	<div class="ms-3 text-end"><a href="#" class="text-danger" onClick="digitalocean_delete_droplets(this, '${keys}', '${d.id}', '${d.networks.v4[0].ip_address}')">delete</a></div>
                    </li>`;
                });
            }
*/
            let dropletListArr = await Promise.all(
                droplets.droplets.map(async d => {

                    if (!d.networks.v4[0]?.ip_address) return '';
                    window.doDropletIps.add(d.networks.v4[0].ip_address);

                    if (d.region?.sizes?.length) {
                        window.availableSizes = window.availableSizes || {};
                        window.availableSizes[d.id] = d.region.sizes;
                    }

                    //let linkednot = window.localdata_ips[d.networks.v4[0].ip_address] ? `<span class="text-success" data-bs-toggle="tooltip" data-bs-placement="top" data-bs-title="${window.localdata_ips[d.networks.v4[0].ip_address]}">Linked</span>` : '<span class="text-danger">Not Linked</span>';
                    let ipv = `<a class="link-body-emphasis clicked" href="https://${d.networks.v4[0].ip_address}:8443/" target="_blank">${d.networks.v4[0].ip_address}</a>`;

                    let statusd = '';
                    if( d.status == 'active' ){
                        statusd = `<a class="text-success" href="#" onClick="turnOff(this, '${d.id}', '${keys}')">Active</a>`;
                    } else if( d.status == 'off' ){
                        statusd = `<a class="text-warning" href="#" onClick="turnOn(this, '${d.id}', '${keys}')">${d.status}</a>`;
                    } else {
                        statusd = `<span class="text-danger">${d.status}</a>`;
                    }

                    let metrics_cpu = '0';
                    let metrics_memory = '0';

                    if (d.status === 'active') {
                        try {
                            let metrics = await droplet_metrics(d, keys);

                            let lastCpu = metrics?.cpu?.slice(-1)[0];
                            let lastMem = metrics?.memory?.slice(-1)[0];

                            metrics_cpu = lastCpu?.value ?? 'N/A';
                            metrics_memory = lastMem?.percent ?? 'N/A';

                            const cpuNum = parseFloat(String(metrics_cpu).replace('%', '').trim());
                            if (!isNaN(cpuNum) && cpuNum > 90) {
                                window.doHighCpu++;
                            }

                        } catch (e) {
                            console.warn('metrics error droplet:', d.id, e);
                        }
                    }

                    let zdomains = window.localdata_ips[d.networks.v4[0].ip_address];
                    let linkeddom = '';

                    if (zdomains) {
                        let list = Array.isArray(zdomains) ? zdomains : [zdomains];

                        let results = await Promise.all(
                            list.map(async (domain) => {

                                let ipAddr = await getIpDomain('http://' + domain);

                                return window.localdata_ips?.[ipAddr]
                                    ? `<a class="clickeed" href="http://${domain}" target="_blank">${domain}</a>`
                                    : `<a class="text-danger clicked" href="http://${domain}" target="_blank">${domain}</a>`;
                            })
                        );

                        linkeddom = results.join(', ');
                    }

                    return `<li class="list-group-item list-group-item-action list-group-item-primary pt-1 pb-1 d-flex align-items-center">
                        <div class="flex-grow-1">
                            <div>[<span class="sizeslug">${d.size_slug}</span>] ${ipv} ${linkeddom}</div>
                            <div class="text-muted" data-metrics="${d.id}">cpu: ${metrics_cpu} | memory : ${metrics_memory} | uptime : ${formatUptime(d.created_at)}</div>
                            <div class="text-muted" data-metrics="${d.id}">vcpu: ${d.vcpus} | ram : ${d.memory} | disk : ${d.disk}GB</div>
                        </div>
                        <div class="me-3 text-nowrap">[${statusd}]</div>
                        <div class="ms-auto text-end"><a href="#" class="text-warning" onClick="showResizeModal(this, '${keys}', '${d.id}', '${d.size_slug}')">Upgrade</a></div>
                        <div class="ms-3 text-end"><a href="#" class="text-danger" onClick="digitalocean_delete_droplets(this, '${keys}', '${d.id}', '${d.networks.v4[0].ip_address}')">delete</a></div>
                    </li>`;
                })
            );

            let dropletList = dropletListArr.join('');

            let htm = `
            <div class="col-md-6 mb-3">
                <div class="card h-100">
	                <div class="card-header d-flex justify-content-between align-items-center">
                        <h5>Accounts #${i}</h5>
                        <div class="alert alert-${badge}" role="alert">${data.status}</div>
                    </div>
                    <div class="card-body">
                        <p>Email: ${data.email}</p>
                        <p>${data.status_message}</p>
                        <ul class="list-group list-group-flush" style="font-size:0.9rem">
                            ${dropletList}
                        </ul>
                    </div>
                    <div class="card-footer d-flex justify-content-between">
                        <span>Balance: `+formatDollar(0-parseFloat(billing.month_to_date_balance || 0).toFixed(2))+`</span>
                        <span>Droplets: `+droplets.meta.total+`/${data.droplet_limit}</span>
                    </div>
                </div>
            </div>`;
	        $('<div>').html(htm).contents().addClass('card-append-anim').appendTo('#digitalocean-accounts');
        }
    })
    );

    renderDoNotifications();

    (async () => {
        const results = await Promise.allSettled(
            localDomains.map(async (domain) => {
                const res = await fetch(`https://${domain}/totalposts`, { signal: AbortSignal.timeout(5000) });
                if (!res.ok) return 0;
                const json = await res.json();
                return parseInt(json?.today) || 0;
            })
        );

        const total = results.reduce((sum, r) => sum + (r.status === 'fulfilled' ? r.value : 0), 0);

        if (total > 0) {
            window.doPostsToday = total;
            renderDoNotifications();
        }
    })();
});

function renderDoNotifications() {
    const linked = new Set();
    const unlinked = new Set();
    for (const [ip, domains] of Object.entries(window.localdata_ips || {})) {
        const list = Array.isArray(domains) ? domains : [domains];
        if (window.doDropletIps.has(ip)) {
            list.forEach(d => linked.add(d));
        } else {
            list.forEach(d => unlinked.add(d));
        }
    }

    // droplet DO yang IP-nya sama sekali tidak ditunjuk oleh domain manapun
    let orphanDroplets = 0;
    for (const ip of window.doDropletIps) {
        if (!window.localdata_ips || !window.localdata_ips[ip]) {
            orphanDroplets++;
        }
    }

    let localDataCount = localStorage.length;

    $('#notif-active').text(window.doStats.active);
    $('#notif-error').text(window.doStats.error);
    $('#notif-locked').text(window.doStats.locked);
    $('#notif-droplets').text(window.doTotalDroplets);
    $('#notif-linked').text(linked.size);
    $('#notif-localdata').text(localDataCount);
    $('#notif-cachelimit').text(getLocalStorageLimit());

    const msgs = [];
    if (window.doStats.error > 0)
        msgs.push(`<li class="msg-danger"><i class="bi bi-x-circle-fill"></i> ${window.doStats.error} akun DO berstatus error</li>`);
    if (window.doStats.locked > 0)
        msgs.push(`<li class="msg-warning"><i class="bi bi-lock-fill"></i> ${window.doStats.locked} akun DO terkunci (locked)</li>`);
    if (unlinked.size > 0)
        msgs.push(`<li class="msg-warning"><i class="bi bi-link-45deg"></i> ${unlinked.size} domain local data tidak terhubung ke IP droplet</li>`);
    if (orphanDroplets > 0)
        msgs.push(`<li class="msg-warning"><i class="bi bi-hdd-network"></i> ${orphanDroplets} droplet tidak terhubung ke domain manapun</li>`);
    if (window.doHighCpu > 0)
        msgs.push(`<li class="msg-danger"><i class="bi bi-cpu-fill"></i> ${window.doHighCpu} droplet memiliki beban CPU &gt; 90%</li>`);
    if (window.doPostsToday > 0)
        msgs.push(`<li class="msg-info"><i class="bi bi-pencil-square"></i> Post Today: +${window.doPostsToday.toLocaleString()}</li>`);

    if (msgs.length === 0)
        msgs.push(`<li class="msg-ok"><i class="bi bi-check-circle-fill"></i> Semua sistem normal</li>`);

    $('#notif-messages').html(msgs.join(''));
}

function getLocalStorageLimit() {
    try {
        let total = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            total += (localStorage.getItem(k) || '').length + (k || '').length;
        }
        // Estimasi batas localStorage browser (~5MB standar)
        const LIMIT = 5 * 1024 * 1024;
        const usedMb = (total / (1024 * 1024)).toFixed(2);
        const limitMb = (LIMIT / (1024 * 1024)).toFixed(0);
        return usedMb + ' / ' + limitMb + ' MB';
    } catch (e) {
        return 'N/A';
    }
}
async function buildHtml(zdomains) {
    const linkeddom = await Promise.all(
    (Array.isArray(zdomains) ? zdomains : [zdomains]).map(async d => {
        const ip = await getIpDomain('http://' + d);
        const ok = window.localdata_ips?.[ip];

            return `<a class="${ok ? '' : 'text-danger'}" href="http://${d}" target="_blank">${d}</a>`;
        })
    ).then(r => r.join(', '));
}
async function getUsageNetdata(url) {
    try {
        const res = await fetch(url, {
            signal: AbortSignal.timeout(3000)
        });

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }

        const json = await res.json();

        const cpuIdle = json?.['system.cpu']?.dimensions?.idle?.value;
        const ramUsed = json?.['system.ram']?.dimensions?.used?.value;
        const ramFree = json?.['system.ram']?.dimensions?.free?.value;
        const ramCached = json?.['system.ram']?.dimensions?.cached?.value ?? 0;
        const ramBuffers = json?.['system.ram']?.dimensions?.buffers?.value ?? 0;

        if (
            cpuIdle === undefined ||
            ramUsed === undefined ||
            ramFree === undefined
        ) {
            throw new Error('Missing metrics');
        }

        const cpu = +(100 - cpuIdle).toFixed(2);

        const ramTotal = ramUsed + ramFree + ramCached + ramBuffers;
        const ram = +((ramUsed / ramTotal) * 100).toFixed(2);

        return {
            cpu,
            ram
        };
    } catch (e) {
        return {
            cpu: '-',
            ram: '-'
        };
    }
}
async function digitalocean_account(keys){

    try {

        let response = await $.ajax({
            url: 'https://api.digitalocean.com/v2/account',
            headers: {
                'Authorization': 'Bearer ' + keys
            },
            dataType: 'json'
        });

        return response;

    } catch (xhr) {

        if (xhr.status === 401) {

            return {
                status: false,
                message: '401 Unauthorized'
            };
        }

        return {
            status: false,
            message: 'Request Failed'
        };
    }
}
function digitalocean_balance(keys){
	return $.ajax({
		url: 'https://api.digitalocean.com/v2/customers/my/balance',
		headers: {'Authorization': 'Bearer '+keys},
		dataType: 'json',
		success: function(response){
			return response;
		}
	});
}
function digitalocean_droplets(keys){
	return $.ajax({
		url: 'https://api.digitalocean.com/v2/droplets?page=1&per_page=200',
		headers: {'Authorization': 'Bearer '+keys},
		dataType: 'json',
		success: function(response){
			return response;
		}
	});
}
function turnOff(el, droplet_id, token) {
    const $el = $(el);
    $el.removeClass().addClass('text-info-emphasis').text('shuttingdown').off('click');

    return doDigitalOceanAction(droplet_id, token, {
        type: "power_off"
    })
    .then(() => new Promise(r => setTimeout(r, 5000)))
    .then(() => {
        $el.removeClass().addClass('text-warning').text('off').attr('onclick', `turnOn(this, '${droplet_id}', '${token}')`);
    });
}
function turnOn(el, droplet_id, token) {
    const $el = $(el);

    $el.removeClass().addClass('text-info-emphasis').text('activating').off('click');

    return doDigitalOceanAction(droplet_id, token, {
        type: "power_on"
    })
    .then(() => new Promise(r => setTimeout(r, 5000)))
    .then(() => {
        $el.removeClass().addClass('text-success').text('Active').attr('onclick', `turnOff(this, '${droplet_id}', '${token}')`);
    });
}
function doDigitalOceanAction(droplet_id, token, data) {
    return $.ajax({
        url: 'https://api.digitalocean.com/v2/droplets/' + droplet_id + '/actions',
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
        },
        data: JSON.stringify(data)
    });
}
function showResizeModal(el, token, droplet_id, current_size) {
    const sizes = window.availableSizes?.[droplet_id];
    if (!sizes || !sizes.length) {
        alert('Tidak ada size tersedia untuk region ini');
        return;
    }

    $('#resizeCurrent').text(current_size);

    const $select = $('#resizeSizeSelect').empty();
    sizes.forEach(s => {
        const selected = s === current_size ? ' selected' : '';
        $select.append(`<option value="${s}"${selected}>${s}</option>`);
    });

    const modal = bootstrap.Modal.getOrCreateInstance($('#resizeModal')[0]);
    modal.show();

    $('#btnConfirmResize').off('click').on('click', function () {
        const selectedSize = $select.val();
        modal.hide();
        resizeDropletFlow(el, token, droplet_id, selectedSize);
    });
}

function resizeDropletFlow(el, token, droplet_id, selectedSize) {
    let $li = $(el).closest('li');

    let final_size = null;

    $li.find('.sizeslug').text('Upgrading...');

    return doDigitalOceanAction(droplet_id, token, {
        type: "power_off"
    })

    .then(() => new Promise(r => setTimeout(r, 30000)))

    .then(() => {
        console.log("Coba resize:", selectedSize);
        return doDigitalOceanAction(droplet_id, token, {
            type: "resize",
            disk: true,
            size: selectedSize
        });
    })

    .then(() => {
        final_size = selectedSize;
        return new Promise(r => setTimeout(r, 30000));
    })

    .then(() => {
        return doDigitalOceanAction(droplet_id, token, {
            type: "power_on"
        });
    })

    .then(() => {
        $li.find('.sizeslug').text(final_size);
        console.log("Selesai:", final_size);
    renderDoNotifications();

    (async () => {
        const results = await Promise.allSettled(
            localDomains.map(async (domain) => {
                const res = await fetch(`https://${domain}/totalposts`, { signal: AbortSignal.timeout(5000) });
                if (!res.ok) return 0;
                const json = await res.json();
                return parseInt(json?.today) || 0;
            })
        );

        const total = results.reduce((sum, r) => sum + (r.status === 'fulfilled' ? r.value : 0), 0);

        if (total > 0) {
            window.doPostsToday = total;
            renderDoNotifications();
        }
    })();
    })

    .catch(err => {
        console.error("Resize gagal:", err.responseText || err);
        $li.find('.sizeslug').text('Failed');
    });
}
function digitalocean_delete_droplets(el, keys, droplet_id, droplet_ip){
	let konfirmasi = confirm("Apakah Anda yakin menghapus "+droplet_ip+" droplets_id : "+droplet_id);
	if(!konfirmasi) return;

	let $li = $(el).closest('li');

	$.ajax({
		url: 'https://api.digitalocean.com/v2/droplets/' + droplet_id,
		method: 'DELETE',
		headers: {
			'Authorization': 'Bearer ' + keys
		},
		complete: function(xhr){
			// DigitalOcean DELETE biasanya return 204
			if(xhr.status === 204 || xhr.status === 200){
				$li.remove();
				window.doDropletIps.delete(droplet_ip);
				if (window.doTotalDroplets > 0) window.doTotalDroplets--;
				renderDoNotifications();
			}else{
				console.error('Gagal hapus:', xhr.status, xhr.responseText);
				alert('Gagal menghapus droplet');
			}
		},
		error: function(xhr){
			console.error('Error:', xhr.status, xhr.responseText);
			alert('Request error');
		}
	});
}

const CACHE_TTL = 300; // 5 menit

async function droplet_metrics(droplet, token) {

    const cacheKey = droplet.id;
    const nowTime = Date.now();

    if( getcache_localstorage(`metrics_${cacheKey}`) !== null ){
        return getcache_localstorage(`metrics_${cacheKey}`);
    }

    const now = Math.floor(Date.now() / 1000);
    const from = now - 3600;

    function formatBytes(bytes) {

        if (typeof bytes !== 'number' || isNaN(bytes) || bytes <= 0) {
            return '0 B';
        }

        const sizes = ['B','KB','MB','GB','TB','PB'];

        let i = Math.floor(Math.log(bytes) / Math.log(1024));

        // 🔥 clamp biar tidak out of range
        if (i >= sizes.length) i = sizes.length - 1;

        return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
    }

    async function fetch(type, extra = '') {
        let url = `https://api.digitalocean.com/v2/monitoring/metrics/droplet/${type}?host_id=${droplet.id}&start=${from}&end=${now}${extra}`;

        return $.ajax({
            url,
            method: 'GET',
            headers: { Authorization: 'Bearer ' + token }
        });
    }

    // ===== CPU =====
    let cpuRes = await fetch('cpu');

    let cpuUsage = [];

    let idleSeries = cpuRes.data.result.find(r => r.metric.mode === 'idle');

    if (idleSeries) {
        let prevVal = null;
        let prevTime = null;

        idleSeries.values.forEach(v => {
            let ts = v[0];
            let val = parseFloat(v[1]);

            if (prevVal !== null) {
                let deltaVal = val - prevVal;
                let deltaTime = ts - prevTime;

                let idleRate = deltaVal / deltaTime;
                let usage = (1 - idleRate) * 100;

                cpuUsage.push({
                    time: new Date(ts * 1000).toLocaleTimeString(),
                    value: usage.toFixed(2) + ' %'
                });
            }

            prevVal = val;
            prevTime = ts;
        });
    }

    // ===== MEMORY (AVAILABLE → USED) =====
    let memRes = await fetch('memory_available');

    let totalRAM = droplet.memory * 1024 * 1024; // MB → bytes

    let memory = memRes.data.result[0].values.map(v => {
        let available = parseFloat(v[1]);
        let used = totalRAM - available;

        return {
            time: new Date(v[0] * 1000).toLocaleTimeString(),
            used: formatBytes(used),
            available: formatBytes(available),
            percent: ((used / totalRAM) * 100).toFixed(2) + ' %'
        };
    });

    let result = {
        cpu: cpuUsage,
        memory: memory
    };

    setcache_localstorage(`metrics_${cacheKey}`, result, CACHE_TTL);
    return result;
}
function formatUptime(createdAt) {
    const created = new Date(createdAt).getTime();
    if (isNaN(created)) return 'N/A';

    let sec = Math.floor((Date.now() - created) / 1000);
    if (sec < 0) sec = 0;

    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);

    if (d >= 1) return d + 'd ' + h + 'h';
    if (h >= 1) return h + 'h ' + m + 'm';
    return m + 'm';
}
function formatDollar(val) {
    val = parseFloat(val || 0);

    return (val < 0) ? '<span class="text-danger">-$' + Math.abs(val).toFixed(2) + "</span>" : '<span class="text-success">$' + val.toFixed(2) + '</span>';
}