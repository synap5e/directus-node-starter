// $(function () {
//     // See if this is a touch device
//     if ('ontouchstart' in window) {
//         // Set the correct body class
//         $('body').removeClass('no-touch').addClass('touch');

//         // Add the touch toggle to show text
//         $('div.boxInner img').click(function () {
//             $(this).closest('.boxInner').toggleClass('touchFocus');
//         });
//     }
// });

function syncHash() {
    return;
    console.log("syncHash {");
    console.log("History.getState().hash = " + History.getState().hash);
    var hash = History.getState().hash;
    if (hash === "" || hash == "/" || hash == "/gallery" || hash == "/gallery/") {

        // no hash - close open gallery
        $('#blueimp-gallery').data('fullScreen', false);
        $('#blueimp-gallery').data('open', false);
        $('#blueimp-gallery').data('reopen', null);
        if ($('#blueimp-gallery').data('gallery') !== undefined) {
            console.log("hashchange: closing gallery")
            $('#blueimp-gallery').data('gallery').close();
        } else if ($('#blueimp-gallery').data('api') !== undefined) {
            console.log("gallery already closed, using fallback");
            $('#blueimp-gallery').data('api').close();
        }
    } else {
        var place = hash.split("/")[2]
        var id = +place.split("_")[0];
        var full = place.search("_full") !== -1;

        console.log("hashchange: opening gallery to " + id + (full ? " in fullscreen" : ""));

        $('#blueimp-gallery').data('fullScreen', full);
        $('.painting-thumbnail[data-id="' + id + '"]').click();

        if (full) {
            $('#blueimp-gallery').data('reopen', { id: id, fullScreen: false });
        } else {
            $('#blueimp-gallery').data('reopen', null);
        }
    }
    console.log("} syncHash");
}

// $(document).ready(function () {

document.addEventListener("DOMContentLoaded", function () {
    // History.options.html4Mode = true;
    // History.options.debug = true;


    // if (History.getState().hash == "" || History.getState().hash == "/") {
    //     /*console.log("History: pushing /gallery");
    //     History.pushState({}, null, '/gallery');*/
    //     History.replaceState({}, null, "/gallery");
    // }

    /*window.onpopstate = function () {
        console.log('onpopstate', history.length, History.getState().hash, $('#blueimp-gallery').data('open'));
        var hash = History.getState().hash;
        if (hash == "" || hash == "/") {
            //syncHash();
            //console.log('pushState');

            //History.pushState({}, null, '/gallery');
            if ($('#blueimp-gallery').data('open')){
                console.log('onpopstate: closing gallery back button');
                $('#blueimp-gallery').data('api').close();
                $('#blueimp-gallery').data('open', false);
            } else {
                console.log('onpopstate: back');
                History.back();
            }
        } else if (hash == "/gallery" || hash == "/gallery/"){
            ////History.pushState({}, null, '/gallery');
            if ($('#blueimp-gallery').data('open')){
                console.log('onpopstate: closing gallery back button');
                $('#blueimp-gallery').data('api').close();
                $('#blueimp-gallery').data('open', false);
            } else {
                console.log('onpopstate: back');
                History.back();
            }
        }
    }*/

    console.log("document: ready");

    $('#blueimp-gallery').on('opened', function (event) {
        console.log("gallery: opened");

        $('#blueimp-gallery').data('open', true);
        $('#blueimp-gallery').data('api', $('#blueimp-gallery').data('gallery'));

        window.setTimeout(function () {
            if ($('#blueimp-gallery').data('fullScreen')) {
                console.log("adding controls");
                $('.blueimp-gallery').addClass('blueimp-gallery-controls');
            } else {
                console.log("removing controls");
                $('.blueimp-gallery').removeClass('blueimp-gallery-controls');
            }
        });

    }).on('slide', function (event, index, slide) {
        console.log("gallery: slide");

        var id = $(slide).find('.modal').data('id');
        if (!id) {
            id = $(slide).find('img').data('id');
        }

        if ($('#blueimp-gallery').data('fullScreen')) {
            console.log("history: replacing with /" + id + "_full");
            History.replaceState({}, null, "/gallery/" + id + "_full");
            $('#blueimp-gallery').data('reopen', { id: id, fullScreen: false });
        } else if (!$('#blueimp-gallery').data('open')) {
            if (History.getHash() !== (id + "") && History.getHash() !== (id + "_full")) {
                console.log("history: replacing with  /" + id);
                History.replaceState({}, null, "/gallery/" + id);
            }
        } else {
            console.log("history: replacing with #" + id);
            History.replaceState({}, null, "/gallery/" + id);
            $('#blueimp-gallery').data('reopen', null);
        }

    }).on('slidecomplete', function (event, index, slide) {
        console.log("gallery: slidecomplete");

    }).on('slideend', function (event, index, slide) {
        console.log("gallery: slideend");

    }).on('fullScreen', function (event, index) {
        console.log("gallery: fullScreen");

        index = $('#blueimp-gallery').data('gallery').index;
        //console.log("history: adding #" + index + "_full");
        var id = $('.slide[data-index="' + index + '"]').find('.modal').data('id');


        // reopen the gallery in fullscreen mode to the same index
        $('#blueimp-gallery').data('reopen', { id: id, fullScreen: true });
        $('#blueimp-gallery').data('gallery').close();

    }).on('close', function (event) {
        console.log("gallery: close");


    }).on('closed', function (event) {
        console.log("gallery: closed");

        if ($('#blueimp-gallery').data('reopen')) {
            var reopenData = $('#blueimp-gallery').data('reopen');
            console.log("reopen: ", reopenData);

            $('#blueimp-gallery').data('fullScreen', reopenData.fullScreen);
            $('.painting-thumbnail[data-id="' + reopenData.id + '"]').click();

            if (reopenData.fullScreen) {
                // if we are reopening in fullscreen mode then don't clear "reopen", but unset fullscreen.
                // this means when the gallery is closed from fullscreen it will reopen in windowed mode
                reopenData.fullScreen = false;
            } else {
                // if we are not reopening in fullscreen we just reopened in windowed mode, so we don't want to reopen on close
                $('#blueimp-gallery').data('reopen', null);
            }

        } else {
            console.log("History: replacing with /gallery");
            History.replaceState({}, null, "/gallery");

            if (history.length != 3) {
                // arrived at a linked image specifically and now getting to the gallery for the first time
                console.log("History: late pushing /gallery")
                //History.pushState({}, null, '/gallery/');
            }


        }
    });

    // syncHash();
});

/*$(window).on('onstatechange', function() {
    syncHash();
});
*/




/*$('#modal').on('show.bs.modal', function (event) {
    var button = $(event.relatedTarget) // Button that triggered the modal

    var modal = $(this);
    var portrait = button.data('portrait') === "True";

    modal.find('.modal-title').text(button.data('title'));
    modal.find('.modal-image').attr("src", button.data('image'));

    if (portrait) {
        modal.find('.modal-portrait').show();
        modal.find('.modal-landscape').hide();
    } else {
        modal.find('.modal-portrait').hide();
        modal.find('.modal-landscape').show();
    }

})
*/