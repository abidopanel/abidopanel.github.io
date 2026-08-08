const MAX_DROPLETS = 10;
const CREATE_BATCH_SIZE = 10;
const CREATE_REGIONS = ['nyc1','nyc3','sfo2','sfo3','ams3','sgp1','lon1','fra1','tor1','syd1'];
const CREATE_IMAGE = 'debian-13-x64';
const CREATE_SIZE = 's-1vcpu-1gb';

$(document).ready(async function () {
    let do_api_keys = $('#digitalocean-data').html().trim().split("\n").map(s => s.trim()).filter(Boolean);
    const ips = {};

    window.doStats = { active: 0, error: 0, locked: 0 };
    window.doTotalDroplets = 0;
    window.doDropletIps = new Set();
    window.doHighCpu = 0;

    const localRaw = (getcache_localstorage('cookie_localdata_data') || '').trim().split('\n').map(s => s.trim()).filter(Boolean);
    localRaw.forEach(line => {
        const parts = line.split('|').map(s => s.trim());
        if (parts.length === 2 && parts[0] && parts[1]) {
            if (!ips[parts[0]]) ips[parts[0]] = [];
            if (!ips[parts[0]].includes(parts[1])) ips[parts[0]].push(parts[1]);
        }
    });
    window.localdata_ips = ips;

    // Tampilkan loading placeholder untuk tiap akun (urutan tetap), lalu isi saat selesai
    do_api_keys.forEach((_, i) => {
        const placeholder = `
        <div class="col-md-6 mb-3" data-card-index="${i}">
            <div class="card h-100">
                <div class="card-body d-flex align-items-center justify-content-center" style="min-height:140px">
                    <div class="text-center text-muted">
                        <div class="spinner-border spinner-border-sm text-primary mb-2" role="status"></div>
                        <div>Loading Account #${i + 1}...</div>
                    </div>
                </div>
            </div>
        </div>`;
        $('<div>').html(placeholder).contents().appendTo('#digitalocean-accounts');
    });

    function replaceCard(i, htm) {
        $('#digitalocean-accounts [data-card-index="' + i + '"]').replaceWith(
            $('<div>').html(htm).contents().addClass('card-append-anim')
        );
    }

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

            replaceCard(i, htm);

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
                    <p class="text-break">API Key: <code class="text-break">${keys}</code></p>
                    <p>${data.status_message || 'Pokoknya Locked 😋' }</p>
                </div>
	                <div class="card-footer d-flex justify-content-between">
	                    <span>Balance: -</span>
	                    <span>Limit: -</span>
	                </div>
	            </div>
	        </div>`;
	        replaceCard(i, htm);
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
                droplets.droplets.map(d => buildDropletLi(d, keys))
            );

            let dropletList = dropletListArr.join('');

            const dropletLimit = Math.max(1, data.droplet_limit || 1);
            const createDefault = Math.min(MAX_DROPLETS, dropletLimit);
            let createOptions = '';
            for (let n = 1; n <= dropletLimit; n++) {
                createOptions += `<option value="${n}"${n === createDefault ? ' selected' : ''}>${n}</option>`;
            }

            let htm = `
            <div class="col-md-6 mb-3">
                <div class="card h-100">
	                <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
                        <div class="d-flex align-items-center gap-2 flex-wrap">
                            <h5 class="mb-0">Accounts #${i}</h5>
                            <div class="alert alert-${badge} mb-0 py-1 px-2" role="alert">${data.status}</div>
                        </div>
                        <div class="d-flex align-items-center gap-2 flex-wrap">
                            <label class="form-check-label mb-0 d-flex align-items-center gap-1 small text-nowrap">
                                <input type="checkbox" class="form-check-input mt-0 select-all-drp" title="Select all droplets">
                                Select All
                            </label>
                            <div class="btn-group btn-group-sm gap-1">
                                <button type="button" class="btn btn-success droplet-bulk-turnon" title="Power on selected">Turn On</button>
                                <button type="button" class="btn btn-warning droplet-bulk-turnoff" title="Power off selected">Turn Off</button>
                                <button type="button" class="btn btn-info droplet-bulk-restart" title="Reboot selected">Restart</button>
                                <button type="button" class="btn btn-danger droplet-bulk-delete" title="Delete selected">Delete</button>
                            </div>
                        </div>
                    </div>
                    <div class="card-body">
                        <p class="mb-1">Email: ${data.email}</p>
                        <p class="mb-1 text-break">API Key: <code class="text-break">${keys}</code></p>
                        <p>${data.status_message}</p>
                        <ul class="list-group list-group-flush" style="font-size:0.9rem">
                            ${dropletList}
                        </ul>
                    </div>
                    <div class="card-footer">
                        <div class="d-flex justify-content-between flex-wrap gap-2 mb-2">
                            <span>Balance: `+formatDollar(0-parseFloat(billing.month_to_date_balance || 0).toFixed(2))+`</span>
                            <span>Droplets: <b class="do-droplet-count">`+droplets.meta.total+`</b>/`+data.droplet_limit+`</span>
                        </div>
                        <div class="d-flex justify-content-end align-items-center gap-2 flex-wrap">
                            <button type="button" class="btn btn-sm btn-outline-primary droplet-copy-ips" title="Copy all droplet IPs"><i class="bi bi-copy"></i> Copy IPs</button>
                            <select class="form-select form-select-sm create-count" title="Jumlah droplet" style="width:auto">
                                ${createOptions}
                            </select>
                            <button type="button" class="btn btn-sm btn-primary droplet-create" data-token="${keys}"><i class="bi bi-pencil-square"></i> Droplets</button>
                            <button type="button" class="btn btn-sm btn-outline-secondary droplet-hunt" style="border-color: #6f42c1" data-token="${keys}"><i class="bi bi-crosshair"></i> Scan</button>
                        </div>
                    </div>
                </div>
            </div>`;
	        replaceCard(i, htm);
        }
    })
    );

    renderDoNotifications();

    enrichAllDomains($('#digitalocean-accounts'));
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

    if (msgs.length === 0)
        msgs.push(`<li class="msg-ok"><i class="bi bi-check-circle-fill"></i> Semua sistem normal</li>`);

    $('#notif-messages').html(msgs.join(''));
}

function bumpDropletCount(card, delta) {
    const $el = $(card).find('.do-droplet-count');
    if (!$el.length) return;
    const cur = parseInt($el.text(), 10) || 0;
    $el.text(Math.max(0, cur + delta));
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
				bumpDropletCount($(el).closest('.card'), -1);
				enrichRemoveForIp(droplet_ip);
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

// ===== Select All & Bulk Actions (untuk droplet dalam satu kartu akun) =====
$(document).on('change', '.select-all-drp', function () {
    const card = $(this).closest('.card');
    card.find('.droplet-select').prop('checked', $(this).is(':checked'));
});

$(document).on('change', '.droplet-select', function () {
    syncSelectAll($(this).closest('.card'));
});

// Klik area kosong pada baris droplet otomatis toggle checkbox-nya,
// kecuali klik pada elemen interaktif (link, tombol, checkbox, dsb).
$(document).on('click', '#digitalocean-accounts li.list-group-item', function (e) {
    if ($(e.target).closest('a, button, input, select, textarea, label, .form-check, .droplet-domains').length) return;
    const $cb = $(this).find('.droplet-select');
    if ($cb.length) {
        $cb.prop('checked', !$cb.is(':checked')).trigger('change');
    }
});

function getSelectedDroplets(btn) {
    return $(btn).closest('.card').find('.droplet-select:checked').map(function () {
        return {
            id: $(this).data('id'),
            ip: $(this).data('ip'),
            token: $(this).data('token')
        };
    }).get();
}

// Toggle dropdown daftar domain pada baris droplet
function toggleDropletDomains(btn) {
    const $li = $(btn).closest('li');
    const $coll = $li.find('.droplet-domains').first();
    if (!$coll.length) return;

    $li.find('.bi-chevron-down, .bi-chevron-up').toggleClass('bi-chevron-down bi-chevron-up');

    if ($coll.hasClass('open')) {
        $coll.css('max-height', '0').removeClass('open');
    } else {
        $coll.css('max-height', '0');
        $coll.addClass('open').css('max-height', $coll[0].scrollHeight + 'px');
    }
}

function syncSelectAll(card) {
    const total = card.find('.droplet-select').length;
    const checked = card.find('.droplet-select:checked').length;
    card.find('.select-all-drp').prop('checked', total > 0 && total === checked);
}

$(document).on('click', '.droplet-bulk-turnon', function () {
    const card = $(this).closest('.card');
    const items = getSelectedDroplets(this);
    if (!items.length) { alert('Pilih droplet terlebih dahulu'); return; }
    if (!confirm('Nyalakan ' + items.length + ' droplet?')) return;

    Promise.allSettled(items.map(d => doDigitalOceanAction(d.id, d.token, { type: 'power_on' }))).then(results => {
        const failed = results.filter(r => r.status === 'rejected').length;
        card.find('.droplet-select').prop('checked', false);
        syncSelectAll(card);
        alert(failed > 0 ? 'Berhasil: ' + (items.length - failed) + ', Gagal: ' + failed + ' droplet.' : 'Semua ' + items.length + ' droplet berhasil dinyalakan.');
    });
});

$(document).on('click', '.droplet-bulk-turnoff', function () {
    const card = $(this).closest('.card');
    const items = getSelectedDroplets(this);
    if (!items.length) { alert('Pilih droplet terlebih dahulu'); return; }
    if (!confirm('Matikan ' + items.length + ' droplet?')) return;

    Promise.allSettled(items.map(d => doDigitalOceanAction(d.id, d.token, { type: 'power_off' }))).then(results => {
        const failed = results.filter(r => r.status === 'rejected').length;
        card.find('.droplet-select').prop('checked', false);
        syncSelectAll(card);
        alert(failed > 0 ? 'Berhasil: ' + (items.length - failed) + ', Gagal: ' + failed + ' droplet.' : 'Semua ' + items.length + ' droplet berhasil dimatikan.');
    });
});

$(document).on('click', '.droplet-bulk-restart', function () {
    const card = $(this).closest('.card');
    const items = getSelectedDroplets(this);
    if (!items.length) { alert('Pilih droplet terlebih dahulu'); return; }
    if (!confirm('Restart ' + items.length + ' droplet?')) return;

    Promise.allSettled(items.map(d => doDigitalOceanAction(d.id, d.token, { type: 'reboot' }))).then(results => {
        const failed = results.filter(r => r.status === 'rejected').length;
        card.find('.droplet-select').prop('checked', false);
        syncSelectAll(card);
        alert(failed > 0 ? 'Berhasil: ' + (items.length - failed) + ', Gagal: ' + failed + ' droplet.' : 'Semua ' + items.length + ' droplet berhasil direstart.');
    });
});

$(document).on('click', '.droplet-bulk-delete', function () {
    const card = $(this).closest('.card');
    const items = getSelectedDroplets(this);
    if (!items.length) { alert('Pilih droplet terlebih dahulu'); return; }
    if (!confirm('Hapus ' + items.length + ' droplet?')) return;

    const results = { ok: 0, fail: 0 };

    items.forEach(d => {
        $.ajax({
            url: 'https://api.digitalocean.com/v2/droplets/' + d.id,
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + d.token },
            complete: function (xhr) {
                if (xhr.status === 204 || xhr.status === 200) {
                    results.ok++;
                    const $cb = $('.droplet-select[data-id="' + d.id + '"]');
                    const $card = $cb.closest('.card');
                    $cb.closest('li').remove();
                    window.doDropletIps.delete(d.ip);
                    if (window.doTotalDroplets > 0) window.doTotalDroplets--;
                    bumpDropletCount($card, -1);
                    enrichRemoveForIp(d.ip);
                } else {
                    results.fail++;
                    console.error('Gagal hapus:', xhr.status, xhr.responseText);
                }

                if ((results.ok + results.fail) === items.length) {
                    syncSelectAll(card);
                    renderDoNotifications();
                }
            }
        });
    });
});

// ===== BUILD satu baris droplet =====
async function buildDropletLi(d, keys) {
    if (!d.networks.v4[0]?.ip_address) return '';
    const dropletIp = d.networks.v4[0].ip_address;
    window.doDropletIps.add(dropletIp);

    if (d.region?.sizes?.length) {
        window.availableSizes = window.availableSizes || {};
        window.availableSizes[d.id] = d.region.sizes;
    }

    const ipv = `<a class="link-body-emphasis clicked droplet-ip-copy" href="javascript:void(0)" title="Klik untuk salin IP" onClick="copyDropletIp(this, '${dropletIp}')">${dropletIp}</a>`;

    let statusd = '';
    if (d.status == 'active') {
        statusd = `<a class="text-success" href="#" onClick="turnOff(this, '${d.id}', '${keys}')">Active</a>`;
    } else if (d.status == 'off') {
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

    let zdomains = window.localdata_ips[dropletIp];
    let linkedCount = 0;
    let listHtml = '';
    let domains = [];

    if (zdomains) {
        domains = Array.isArray(zdomains) ? zdomains.slice() : [zdomains];
        let results = await Promise.all(
            domains.map(async (domain) => {
                let ipAddr = await getIpDomain('http://' + domain);
                return { domain, matched: ipAddr === dropletIp };
            })
        );
        linkedCount = results.filter(r => r.matched).length;
        listHtml = results.length ? `<ul class="list-group list-group-flush mt-2 mb-0" style="font-size:.85rem">${
            results.map(r =>
                `<li class="list-group-item bg-transparent border-0 py-1 px-0">
                    <a class="${r.matched ? 'text-success' : 'text-danger'}" href="http://${r.domain}" target="_blank">${r.domain}</a>${r.matched ? '' : ' <span class="text-muted small">(mismatch)</span>'}
                    <div class="text-muted small domain-enrich" data-domain="${r.domain}">...</div>
                </li>`
            ).join('')
        }</ul>` : '';
    }

    let mismatchCount = domains.length - linkedCount;

    let linkedLabel = linkedCount > 0
        ? `<a href="javascript:void(0)" class="linked-count text-decoration-none" title="Toggle domain list" onClick="toggleDropletDomains(this)"><span class="badge rounded-pill text-bg-primary">${linkedCount} linked domain</span></a> `
        : '';
    let mismatchLabel = mismatchCount > 0
        ? `<a href="javascript:void(0)" class="linked-count text-decoration-none" title="Toggle domain list" onClick="toggleDropletDomains(this)"><span class="badge rounded-pill text-bg-danger">${mismatchCount} mismatch</span></a>`
        : '';

    const domainToggleBtn = `<a href="javascript:void(0)" class="text-info domain-toggle" title="Toggle domain list" onClick="toggleDropletDomains(this)"><i class="bi bi-chevron-down"></i></a>`;

    const searchStr = [d.id, dropletIp, d.size_slug, d.vcpus, d.memory, d.disk, metrics_cpu, metrics_memory]
        .concat(domains).filter(Boolean).join(' ').toLowerCase().replace(/"/g, '&quot;');

    return `<li class="list-group-item list-group-item-action list-group-item-primary pt-1 pb-1 d-flex align-items-center" data-ip="${dropletIp}" data-search="${searchStr}">
        <div class="form-check me-2 mb-0">
            <input type="checkbox" class="form-check-input mt-0 droplet-select" data-id="${d.id}" data-ip="${dropletIp}" data-token="${keys}" title="Select ${dropletIp}">
        </div>
        <div class="flex-grow-1">
            <div class="d-flex align-items-center justify-content-between flex-wrap gap-2">
                <div>[<span class="sizeslug">${d.size_slug}</span>] ${ipv} <span class="droplet-linked">${linkedLabel}${mismatchLabel}</span></div>
                <div class="text-nowrap d-flex align-items-center gap-2">
                    [${statusd}]
                    <a href="#" class="text-warning" onClick="showResizeModal(this, '${keys}', '${d.id}', '${d.size_slug}')">Upgrade</a>
                    <a href="#" class="text-danger" onClick="digitalocean_delete_droplets(this, '${keys}', '${d.id}', '${dropletIp}')">delete</a>
                    <span class="domain-toggle-wrap${domains.length ? '' : ' d-none'}">${domainToggleBtn}</span>
                </div>
            </div>
            <div class="text-muted" data-metrics="${d.id}">cpu: ${metrics_cpu} | memory : ${metrics_memory} | uptime : <span class="uptime-live" data-uptime="${d.created_at}">${formatUptime(d.created_at)}</span></div>
            <div class="text-muted" data-metrics="${d.id}">vcpu: ${d.vcpus} | ram : ${d.memory} | disk : ${d.disk}GB</div>
            <div class="droplet-domains" style="max-height:0;overflow:hidden;transition:max-height .22s ease">${listHtml}</div>
        </div>
    </li>`;
}

// Append droplet yang baru dibuat ke card (tanpa reload)
// Poll sampai SEMUA droplet yang dibuat tampil (punya public IP), lalu append bertahap.
async function appendCreatedDroplets(token, createdIds) {
    if (!createdIds.length) return;

    const rendered = new Set();
    const $card = $('.droplet-hunt[data-token="' + token + '"]').closest('.card');
    const $list = $card.find('.card-body > ul.list-group');
    const deadline = Date.now() + 120000; // maksimal 2 menit
    let addedTotal = 0;

    while (Date.now() < deadline) {
        let droplets = { droplets: [] };
        try {
            droplets = await digitalocean_droplets(token);
        } catch (e) {
            // lanjut coba lagi
        }

        const pending = (droplets.droplets || []).filter(d =>
            createdIds.indexOf(d.id) !== -1 && !rendered.has(d.id)
        );

        for (const d of pending) {
            const html = await buildDropletLi(d, token);
            if (html) {
                $list.append(html);
                rendered.add(d.id);
                addedTotal++;
            }
        }

        const stillMissing = createdIds.filter(id => !rendered.has(id));
        if (!stillMissing.length) break;

        logLine('[create] Menunggu IP ' + stillMissing.length + ' droplet...', 'log-info');
        await new Promise(r => setTimeout(r, 10000));
    }

    if (addedTotal) {
        if (window.doTotalDroplets !== undefined) window.doTotalDroplets += addedTotal;
        bumpDropletCount($card, addedTotal);
        syncSelectAll($card);
        renderDoNotifications();
        enrichAllDomains($card);
    }

    const missing = createdIds.filter(id => !rendered.has(id));
    if (missing.length) logLine('[create] ' + missing.length + ' droplet belum tampil (IP belum muncul)', 'log-error');
}

// ===== CREATE DROPLETS (tanpa cleanup/destroy) =====
async function doCreateDroplets(token, count) {
    const nonce = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const names = [];
    for (let n = 1; n <= count; n++) names.push('droplet-' + nonce + '-' + n);

    const region = CREATE_REGIONS[Math.floor(Math.random() * CREATE_REGIONS.length)];
    const base = {
        region,
        size: CREATE_SIZE,
        image: CREATE_IMAGE,
        ssh_keys: [],
        backups: false,
        ipv6: false,
        monitoring: true,
        tags: ['auto-created']
    };

    // Set password root lewat user_data (cloud-config) jika dikonfigurasi
    const rootPassword = (window.huntConfig && window.huntConfig.rootPassword || '').trim();
    if (rootPassword) {
        base.user_data =
            "#cloud-config\n" +
            "password: " + rootPassword + "\n" +
            "chpasswd: { expire: False }\n" +
            "ssh_pwauth: True\n";
    }

    let createdIds = [];
    let limitReached = false;
    for (let i = 0; i < names.length; i += CREATE_BATCH_SIZE) {
        const batchNames = names.slice(i, i + CREATE_BATCH_SIZE);
        const payload = Object.assign({}, base, { names: batchNames });
        logLine('[create] Batch ' + batchNames.length + ' droplet (region ' + region + ')...', 'log-info');
        try {
            const res = await fetch('https://api.digitalocean.com/v2/droplets', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.status === 200 || res.status === 202) {
                const j = await res.json();
                const created = j.droplets || [];
                created.forEach(d => createdIds.push(d.id));
                created.forEach(d => logLine('[create] ' + d.name + ' (id ' + d.id + ')', 'log-info'));
                logLine('[create] ' + created.length + ' droplet diantrekan', 'log-info');
            } else {
                let msg = '';
                try { msg = (await res.json()).message || res.statusText; } catch (e) { msg = res.statusText; }
                logLine('[create] HTTP ' + res.status + ': ' + msg, 'log-error');
                if (/limit/i.test(msg)) { limitReached = true; break; }
            }
        } catch (e) {
            logLine('[create] Error: ' + (e.message || e), 'log-error');
        }
    }
    if (!limitReached) {
        logLine('[create] Menunggu IP...', 'log-info');
        await new Promise(r => setTimeout(r, 30000));
    }
    return createdIds;
}

// ===== HUNT IP (mirror hunter: banned -> dns.google) =====
let _epIdx = 0;

function nextEndpoint() {
    const eps = window.huntConfig.vtEndpoints || [];
    if (!eps.length) return null;
    const ep = eps[_epIdx % eps.length];
    _epIdx++;
    return ep;
}

async function ensureBannedDomainsReady() {
    if (window.bannedDomains && window.bannedDomains.length) return true;
    try { await fetchBannedList(); return true; }
    catch (e) { return false; }
}

// ===== ENRICH DOMAIN: DR (ahrefs) + rank/traffic/links (seoquake) =====
const ENRICH_CACHE_KEY = 'cookie_enrich_cache';
const ENRICH_CACHE_TTL = 4 * 3600 * 1000; // 4 jam (ms)

function getEnrichCache() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(ENRICH_CACHE_KEY) || 'null'); } catch (e) {}
    return (raw && typeof raw === 'object') ? raw : {};
}
function saveEnrichCache(cache) {
    try { localStorage.setItem(ENRICH_CACHE_KEY, JSON.stringify(cache)); } catch (e) {}
}
function enrichCachedValue(domain) {
    const e = getEnrichCache()[domain];
    return (e && e.expires > Date.now()) ? e.value : null;
}
function enrichStore(domain, value) {
    const cache = getEnrichCache();
    cache[domain] = { value, expires: Date.now() + ENRICH_CACHE_TTL };
    saveEnrichCache(cache);
}
// Hapus cache enrichment untuk semua domain yang menunjuk ke IP tertentu
function enrichRemoveForIp(ip) {
    const domains = window.localdata_ips && window.localdata_ips[ip];
    if (!domains) return;
    const list = Array.isArray(domains) ? domains : [domains];
    const cache = getEnrichCache();
    let changed = false;
    list.forEach(d => { if (cache[d]) { delete cache[d]; changed = true; } });
    if (changed) saveEnrichCache(cache);
}

function workerBaseUrl() {
    const eps = window.huntConfig.vtEndpoints || [];
    return eps.length ? eps[0] : null;
}

async function enrichDomain(domain) {
    const cached = enrichCachedValue(domain);
    if (cached) return cached;

    const result = { dr: null, rank: null, traffic: null, links: null, age: null };
    const ep = workerBaseUrl();
    if (ep) {
        const sep = ep.includes('?') ? '&' : '?';
        try {
            const ak = (window.huntConfig.ahrefsApiKey || '').trim();
            if (ak) {
                const r = await fetch(ep + sep + 'type=ahrefs&api=' + encodeURIComponent(ak) + '&domain=' + encodeURIComponent(domain));
                if (r.ok) {
                    const j = await r.json();
                    let dr = j.dr;
                    if (dr && typeof dr === 'object') dr = dr.domain_rating ?? null;
                    if (dr !== null && dr !== undefined) result.dr = dr;
                }
            }
            const r2 = await fetch(ep + sep + 'type=seoquake&domain=' + encodeURIComponent(domain));
            if (r2.ok) {
                const j = await r2.json();
                if (j.status === 'ok') {
                    if (j.rank !== null && j.rank !== undefined) result.rank = j.rank;
                    if (j.traffic !== null && j.traffic !== undefined) result.traffic = j.traffic;
                    if (j.links !== null && j.links !== undefined) result.links = j.links;
                    if (j.age !== null && j.age !== undefined) result.age = j.age;
                }
            }
        } catch (e) {
            // enrichment best-effort; keep nulls
        }
    }
    enrichStore(domain, result);
    return result;
}

function formatEnrich(r) {
    const parts = [];
    if (r.dr !== null && r.dr !== undefined) parts.push('DR: ' + r.dr);
    if (r.rank !== null && r.rank !== undefined) parts.push('rank: ' + r.rank);
    if (r.traffic !== null && r.traffic !== undefined) parts.push('traffic: ' + r.traffic);
    if (r.links !== null && r.links !== undefined) parts.push('links: ' + r.links);
    if (r.age !== null && r.age !== undefined) parts.push('age: ' + formatAge(r.age));
    return parts.length ? parts.join(' | ') : '...';
}

function formatAge(days) {
    days = Number(days);
    if (!isFinite(days) || days <= 0) return days + 'd';
    if (days >= 365) {
        const y = days / 365;
        return (y >= 10 ? Math.round(y) : (Math.round(y * 10) / 10)) + ' yr';
    }
    if (days >= 30) return Math.floor(days / 30) + ' mo';
    return days + 'd';
}

async function enrichAllDomains($scope) {
    const cells = $scope.find('.domain-enrich[data-domain]').toArray();
    if (!cells.length) return;
    let i = 0;
    const workers = Array(Math.min(6, cells.length)).fill(0).map(async () => {
        while (i < cells.length) {
            const $c = $(cells[i++]);
            const d = $c.attr('data-domain');
            const res = await enrichDomain(d);
            $c.text(formatEnrich(res));
        }
    });
    await Promise.all(workers);
}

// Cache DNS (dns.google, semua record A) per domain dengan short TTL
const _dnsCache = {};
const _dnsCacheTTL = 300000; // 5 menit

async function resolveAllA(domain) {
    const now = Date.now();
    const cached = _dnsCache[domain];
    if (cached && now - cached.t < _dnsCacheTTL) return cached.v;

    const url = new URL('http://' + domain);
    let addresses = null;
    try {
        const res = await $.ajax({ url: 'https://dns.google/resolve?name=' + url.host + '&type=A', dataType: 'json' });
        const answer = res.Answer || [];
        addresses = answer.filter(r => r.type === 1).map(r => r.data);
    } catch (e) {
        addresses = null;
    }
    _dnsCache[domain] = { t: now, v: addresses };
    return addresses;
}

// Pecahkan batch agar tetap terbatas (tidak semua sekaligus)
async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let i = 0;
    const workers = Array(Math.min(limit, items.length)).fill(0).map(async () => {
        while (i < items.length) {
            const idx = i++;
            results[idx] = await fn(items[idx]);
        }
    });
    await Promise.all(workers);
    return results;
}

// banned mencakup subdomain (mirip str_ends_with): "example.com" banned -> "a.b.example.com" ikut banned
function isBannedDomain(domain) {
    domain = (domain || '').toLowerCase();
    return window.bannedDomains.some(function (b) {
        b = String(b || '').toLowerCase().trim();
        return b && (b === domain || domain.endsWith('.' + b));
    });
}

async function huntIp(ip) {
    const missing = ensureHuntData();
    if (missing.length) {
        logLine('[hunt] Data kurang: ' + missing.join(', '), 'log-error');
        return;
    }
    await ensureBannedDomainsReady();

    const ep = nextEndpoint();
    if (!ep) { logLine('[hunt] Tidak ada endpoint', 'log-error'); return; }
    const keys = window.huntConfig.vtApiKeys || [];
    const apiParam = keys.length ? keys[Math.floor(Math.random() * keys.length)] : '';
    const url = ep + (ep.includes('?') ? '&' : '?') + 'type=virustotal&api=' + encodeURIComponent(apiParam) + '&ip=' + ip;

    let domains = [];
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const j = await res.json();
        domains = (j.domains || []).map(d => String(d).trim().toLowerCase()).filter(Boolean);
    } catch (e) {
        logLine('[hunt] ' + ip + ' error: ' + (e.message || e), 'log-error');
        return;
    }

    if (!domains.length) {
        logLine('[hunt] ' + ip + ' tidak ada domain dari endpoint', 'log-info');
        return;
    }

    // Parallel resolve (terbatas) + hanya satu refresh per IP setelah selesai
    const checks = await mapLimit(domains, 8, async (domain) => {
        if (isBannedDomain(domain)) {
            return { domain, status: 'banned' };
        }
        const addresses = await resolveAllA(domain);
        if (addresses === null) {
            return { domain, status: 'unresolved' };
        }
        if (addresses.indexOf(ip) !== -1) {
            return { domain, status: 'match' };
        }
        return { domain, status: 'mismatch' };
    });

    let anyMatch = false;
    for (const c of checks) {
        if (c.status === 'match') {
            anyMatch = true;
            logLine('[' + ip + '] ' + c.domain + ' Match', 'log-match');
            addMatch(ip, c.domain);
        } else if (c.status === 'banned') {
            // banned: skip, jangan dianggap match/mismatch & jangan disimpan
            logLine('[' + ip + '] ' + c.domain + ' (banned, skipped)');
        } else if (c.status === 'unresolved') {
            logLine('[' + ip + '] ' + c.domain + ' (unresolved)', 'log-info');
        } else {
            logLine('[' + ip + '] ' + c.domain + ' Mismatch');
        }
    }

    if (anyMatch) await refreshDropletLinked(ip);
}

async function freshDropletIps(token) {
    try {
        const droplets = await digitalocean_droplets(token);
        const ips = [];
        (droplets.droplets || []).forEach(d => {
            const ip = d.networks.v4 && d.networks.v4[0] && d.networks.v4[0].ip_address;
            if (ip) { ips.push(ip); window.doDropletIps.add(ip); }
        });
        return ips;
    } catch (e) {
        return [];
    }
}

async function huntCard(token, ipList) {
    const missing = ensureHuntData();
    if (missing.length) {
        const msg = 'Data hunter belum lengkap: ' + missing.join(', ') + '. Isi di Settings.';
        logLine('[hunt] ' + msg, 'log-error');
        alert(msg);
        return;
    }

    let ips = ipList;
    if (!ips) {
        ips = await freshDropletIps(token);
    }

    logLine('[hunt] Memeriksa ' + ips.length + ' IP...', 'log-info');

    let i = 0;
    const workers = Array(Math.min(5, ips.length)).fill(0).map(async () => {
        while (i < ips.length) {
            const ip = ips[i++];
            try { await huntIp(ip); } catch (e) { logLine('[hunt] ' + ip + ' error: ' + (e.message || e), 'log-error'); }
        }
    });
    await Promise.all(workers);
    logLine('[hunt] Selesai', 'log-info');
    renderDoNotifications();
}

// ===== MATCH -> localdata (persist) =====
function addMatch(ip, domain) {
    domain = domain.toLowerCase();
    if (!window.localdata_ips[ip]) window.localdata_ips[ip] = [];
    if (window.localdata_ips[ip].indexOf(domain) === -1) {
        window.localdata_ips[ip].push(domain);

        const KEY = 'cookie_localdata_data';
        let existing = getcache_localstorage(KEY) || '';
        const lines = existing.split('\n').map(s => s.trim()).filter(Boolean);
        const entry = ip + '|' + domain;
        if (lines.indexOf(entry) === -1) {
            lines.push(entry);
            setcache_localstorage(KEY, lines.join('\n'), 30 * 86400);
        }

        // append ke textarea Local Data di Settings agar terlihat tanpa reload
        const $localTextarea = $('#local-data');
        if ($localTextarea.length) {
            const tLines = ($localTextarea.val() || '').split('\n').map(s => s.trim()).filter(Boolean);
            if (tLines.indexOf(entry) === -1) {
                tLines.push(entry);
                $localTextarea.val(tLines.join('\n'));
            }
        }
    }
    if (window.localdata_set) window.localdata_set[domain] = true;
}

// Rebuild badge + dropdown satu baris droplet di tempat (realtime, tanpa reload)
async function refreshDropletLinked(ip) {
    const $li = $('#digitalocean-accounts li[data-ip="' + ip + '"]');
    if (!$li.length) return;

    const zdomains = window.localdata_ips[ip] || [];
    const results = await mapLimit(zdomains, 8, async (domain) => {
        const addresses = await resolveAllA(domain);
        return { domain, matched: addresses !== null && addresses.indexOf(ip) !== -1 };
    });

    const linkedCount = results.filter(r => r.matched).length;
    const mismatchCount = results.length - linkedCount;

    let labels = '';
    if (linkedCount > 0)
        labels += `<a href="javascript:void(0)" class="linked-count text-decoration-none" title="Toggle domain list" onClick="toggleDropletDomains(this)"><span class="badge rounded-pill text-bg-primary">${linkedCount} linked domain</span></a> `;
    if (mismatchCount > 0)
        labels += `<a href="javascript:void(0)" class="linked-count text-decoration-none" title="Toggle domain list" onClick="toggleDropletDomains(this)"><span class="badge rounded-pill text-bg-danger">${mismatchCount} mismatch</span></a>`;

    const listHtml = results.length ? `<ul class="list-group list-group-flush mt-2 mb-0" style="font-size:.85rem">${
        results.map(r =>
            `<li class="list-group-item bg-transparent border-0 py-1 px-0">
                <a class="${r.matched ? 'text-success' : 'text-danger'}" href="http://${r.domain}" target="_blank">${r.domain}</a>${r.matched ? '' : ' <span class="text-muted small">(mismatch)</span>'}
                <div class="text-muted small domain-enrich" data-domain="${r.domain}">...</div>
            </li>`
        ).join('')
    }</ul>` : '';

    $li.find('.droplet-linked').html(labels);

    const $dom = $li.find('.droplet-domains');
    $dom.html(listHtml);
    if ($dom.hasClass('open')) setTimeout(() => $dom.css('max-height', $dom[0].scrollHeight + 'px'), 0);
    $li.find('.domain-toggle-wrap').toggleClass('d-none', !results.length);

    const extra = results.map(r => r.domain).join(' ');
    if (extra) $li.attr('data-search', ($li.attr('data-search') || '') + ' ' + extra);

    enrichAllDomains($li);
}

// ===== Delegate create & hunt buttons =====
$(document).on('click', '.droplet-create', async function () {
    const $card = $(this).closest('.card');
    const token = $(this).data('token');
    const count = parseInt($card.find('.create-count').val(), 10) || 1;

    if (!confirm('Buat ' + count + ' droplet untuk akun ini?')) return;

    $(this).prop('disabled', true).html('<span class="spinner-border spinner-border-sm"></span> Creating...');
    const created = await doCreateDroplets(token, count);
    $(this).prop('disabled', false).html('<i class="bi bi-pencil-square"></i> Droplets');

    if (created.length) {
        await appendCreatedDroplets(token, created);
    }
});

$(document).on('click', '.droplet-hunt', async function () {
    await huntCard($(this).data('token'));
});

$(document).on('click', '.droplet-copy-ips', function () {
    const $card = $(this).closest('.card');
    const ips = [];
    $card.find('.droplet-select').each(function () {
        const ip = $(this).data('ip');
        if (ip) ips.push(ip);
    });
    if (!ips.length) { alert('Tidak ada droplet pada akun ini'); return; }
    copyText(ips.join('\n'), $(this));
});

function copyText(text, $btn) {
    const done = function () {
        const old = $btn.html();
        $btn.html('<i class="bi bi-check2"></i> Copied');
        setTimeout(function () { $btn.html(old); }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text); done(); });
    } else {
        fallbackCopy(text);
        done();
    }
}
function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
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
    return formatUptimeDate(created);
}
function formatUptimeDate(createdMs) {
    let sec = Math.floor((Date.now() - createdMs) / 1000);
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
function copyDropletIp(el, ip) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ip).then(function () {
            const $el = $(el);
            const old = $el.text();
            $el.text('Copied!');
            setTimeout(function () { $el.text(old); }, 1200);
        }).catch(function () {
            copyDropletIpFallback(ip);
        });
    } else {
        copyDropletIpFallback(ip);
    }
}
function copyDropletIpFallback(ip) {
    const ta = document.createElement('textarea');
    ta.value = ip;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
    const $el = $('.droplet-ip-copy').first();
    if ($el.length) {
        const old = $el.text();
        $el.text('Copied!');
        setTimeout(function () { $el.text(old); }, 1200);
    }
}

// Update uptime berjalan secara ringan: satu interval global, hanya update teks elemen yang ada.
setInterval(function () {
    const nodes = document.querySelectorAll('.uptime-live[data-uptime]');
    for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        const created = new Date(el.getAttribute('data-uptime')).getTime();
        if (isNaN(created)) continue;
        const t = formatUptimeDate(created);
        if (el.textContent !== t) el.textContent = t;
    }
}, 30000);