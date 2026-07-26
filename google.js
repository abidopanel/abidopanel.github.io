$("#sort").on("change", function () { 

    let type = $(this).val();
    let items = $("#chartSite > .card").get();

    items.sort((a, b) => {

        let clickA = parseInt($(a).attr("data-click")) || 0;
        let clickB = parseInt($(b).attr("data-click")) || 0;

        let impA = parseInt($(a).attr("data-impression")) || 0;
        let impB = parseInt($(b).attr("data-impression")) || 0;

        let totalClickA = parseInt($(a).attr("data-totalclick")) || 0;
        let totalClickB = parseInt($(b).attr("data-totalclick")) || 0;

        let totalImpA = parseInt($(a).attr("data-totalimpression")) || 0;
        let totalImpB = parseInt($(b).attr("data-totalimpression")) || 0;

        switch (type) {

            // LAST CLICK
            case "click_asc":
                return clickB - clickA; // terbesar dulu

            case "click_desc":
                return clickA - clickB;

            // LAST IMPRESSION
            case "imp_asc":
                return impB - impA;

            case "imp_desc":
                return impA - impB;

            // TOTAL CLICK
            case "total_click_asc":
                return totalClickB - totalClickA;

            case "total_click_desc":
                return totalClickA - totalClickB;

            // TOTAL IMPRESSION
            case "total_imp_asc":
                return totalImpB - totalImpA;

            case "total_imp_desc":
                return totalImpA - totalImpB;

            default:
                return 0;
        }
    });

    $("#chartSite").html(items);
});

async function getPerformance(sites, access_token, dimensions = ["date"]) {

    let res = await fetch(
        "https://www.googleapis.com/webmasters/v3/sites/" +
        encodeURIComponent(sites) +
        "/searchAnalytics/query",
        {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + access_token,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                startDate: (dimensions == ["HOUR"] ? getStartDate(2) : getStartDate(90)),
                endDate: getStartDate(0),
                dimensions: dimensions,
                dataState: (dimensions == ["HOUR"] ? 'hourly_all' : 'final'),
                rowLimit: 90
            })
        }
    );

    let jjs = await res.json();

    let labels = [];
    let click = [];
    let impression = [];

    let totalClick = 0;
    let totalImpression = 0;

    if (!jjs.rows) {
        return {
            labels,
            click,
            impression,
            ctr: 0,
            totalClick: 0,
            totalImpression: 0
        };
    }

    jjs.rows.forEach(r => {

        let date = new Date(r.keys[0]);

        if( dimensions == ["HOUR"] ){
            if (date <= new Date()) {
              labels.push(date.toLocaleTimeString('id-ID', {
                hour: '2-digit',
                minute: '2-digit'
              }));
            }
        }else{
            labels.push(
                date.toLocaleDateString('en-GB', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric'
                })
            );
        }

        let c = r.clicks || 0;
        let i = r.impressions || 0;

        click.push(c);
        impression.push(i);

        totalClick += c;
        totalImpression += i;
    });

    // CTR global (bukan per hari)
    let ctr = parseFloat((totalImpression > 0 ? (totalClick / totalImpression) : 0)*100).toFixed(2);

    return { labels, click, impression, totalClick, totalImpression, ctr };
}

$("#viewdata").on("change", function () {
    googleapis();
});
$("#renderApex").on("change", function () {
    googleapis();
});
function googleapis(){
    google_data = $('#google-data').html().split("\n").map(s => s.trim()).filter(Boolean);
    $('#chartSite').html('');
    $('#google-messages').html('');
    $('#google-messages-wrap').addClass('d-none');

    $.each(google_data, function(q, refresh){
        generate_token(refresh, function(res){
            token = res['access_token'];
            viewdata = $('#viewdata').val();

            // ambil email dari userinfo
            $.ajax({
                url: 'https://www.googleapis.com/oauth2/v3/userinfo?access_token=' + token,
                dataType: 'json',
                success: function(info){
                    account_email = info.email || '-';
                    loadSites(refresh, token, account_email);
                },
                error: function(){
                    account_email = '-';
                    loadSites(refresh, token, account_email);
                }
            });
        }, refresh);
    });
}

function pushGoogleMessage(message, isError, refresh){
    const $wrap = $('#google-messages-wrap');
    const $list = $('#google-messages');
    if (!$list.length) return;
    $wrap.removeClass('d-none');
    const cls = isError ? 'msg-danger' : 'msg-warning';
    const icon = isError ? 'bi-exclamation-circle-fill' : 'bi-info-circle-fill';
    const tok = refresh ? ` <code>${refresh}</code>` : '';
    $list.append(`<li class="${cls}"><i class="bi ${icon}"></i> ${message}${tok}</li>`);
}


function loadSites(refresh, token, account_email){
    $.ajax({
        url: 'https://www.googleapis.com/webmasters/v3/sites',
        headers: {'Authorization': 'Bearer '+token},
        dataType: 'json',
        success: function(response){
            response.siteEntry.map((s,w) => {
                if( s.permissionLevel != "siteOwner" ){ return; }

                getPerformance(s.siteUrl, token, viewdata).then(performance => {
                    var options = {
                        series: [
                            { name: 'Impression', type: 'column', data: performance.impression },
                            { name: 'Clicks', type: 'line', data: performance.click }
                        ],
                        chart: { height: 350, type: 'line', zoom: { enabled: false } },
                        stroke: { width: [0, 4] },
                        title: { text: undefined },
                        dataLabels: { enabled: true, enabledOnSeries: [1] },
                        labels: performance.labels,
                        yaxis: [
                            { title: { text: 'Impression' } },
                            { opposite: true, title: { text: 'Click' } }
                        ]
                    };

                    $("#chartSite").append(`<div class="card p-4 shadow mt-4">
                        <div class="d-flex flex-column align-items-start gap-3">
                          <h4 id="tiles_${w}" class="mb-0 fw-bold text-break"></h4>
                          <div class="d-flex flex-wrap gap-2">
                            <span class="badge rounded-pill text-bg-warning fs-6">CTR ${performance.ctr}%</span>
                            <span class="badge rounded-pill text-bg-primary fs-6">Click ${performance.totalClick}</span>
                            <span class="badge rounded-pill text-bg-success fs-6">Impression ${performance.totalImpression}</span>
                          </div>
                        </div>
                        <div id="chartContainer_${w}" style="height:380px;">Loading...</div></div>`);

                    getIpDomain(s.siteUrl).then(resolved => {
                        const hostname = new URL(s.siteUrl).hostname;
                        if( window.localdata_set && window.localdata_set[hostname] ){
                            status = resolved ? ' <span class="text-success">Live</span>' : ' <span class="text-danger">Died</span>';
                        } else {
                            status = '';
                        }
                        $('#tiles_'+w).html(`<span class="badge rounded-pill text-bg-secondary me-2">${account_email}</span>${s.siteUrl} (${resolved || '-'}) ${status}`);
                    });
                    $('#chartContainer_'+w).html('');
                    $('#chartContainer_'+w).closest('.card').attr('data-impression', performance.impression.at(-1) || 0);
                    $('#chartContainer_'+w).closest('.card').attr('data-click', performance.click.at(-1) || 0);
                    $('#chartContainer_'+w).closest('.card').attr('data-totalimpression', performance.totalImpression || 0);
                    $('#chartContainer_'+w).closest('.card').attr('data-totalclick', performance.totalClick || 0);

                    if ($('#renderApex').is(':checked')) {
                        let chart = new ApexCharts(document.getElementById('chartContainer_'+w), options);
                        chart.render();
                    } else {
                        $('#chartContainer_'+w).closest('.card').addClass('card-simple');
                        $('#chartContainer_'+w).remove();
                    }
                });
            });
        },
        error: function(xhr){
            let msg = 'Tidak bisa mengakses Search Console: refresh_token mungkin tidak memiliki akses ke resource ini atau sudah tidak valid.';
            if (xhr && xhr.status === 401) {
                msg = '401 Unauthorized: access token ditolak Google. Refresh token kemungkinan sudah tidak berlaku, silakan buat token baru via "Get It!".';
            } else if (xhr && xhr.status === 403) {
                msg = '403 Forbidden: akun tidak memiliki izin (scope) untuk Search Console API pada token ini.';
            }
            pushGoogleMessage(msg, true, refresh);
        }
    });
}

$(document).ready(async function () {
    googleapis();
});