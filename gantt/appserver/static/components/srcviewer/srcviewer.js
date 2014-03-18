define([
    'underscore',
    'jquery',
    'backbone',
    './codeview',
    'bootstrap.tab'
], function(_, $, Backbone, CodeView) {

    var SourceCodeViewer = Backbone.View.extend({
        className: 'dashboard-row sourcecode-viewer',
        options: {
            title: 'Dashboard Source Code'
        },
        initialize: function(){
            this.items = [];
            this.listenTo(this.collection, 'reset remove', this.render, this);
            this.listenTo(this.collection, 'add', this.addItem, this);
            this.listenTo(this.model, 'change', this.render, this);
        },
        events: {
            'click .nav>li>a': function(e){
                e.preventDefault();
                $(e.currentTarget).tab('show');
            }
        },
        addItem: function(model){
            if(!model.has('id')) {
                model.set('id', _.uniqueId('tab_'));
            }
            var id = model.get('id');
            var filename = model.get('name');
            var fileUrl = model.get('url') || '';
            var link = $('<a class="tab-title-text"></a>').text(filename).attr('href', fileUrl + '#' + id)
            var li = $('<li></li>').append(link);
            this.$('.nav-tabs').append(li);

            var item = new CodeView({
                model: model,
                el: $('<div></div>').appendTo(this.$('.tab-content'))
            });
            item.render();

            if(this.items.length == 0) {
                // Activate the tab, if it's the first item
                li.find('a').click();
            }

            this.items.push(item);
            return item;
        },
        render: function(){
            _(this.items).invoke('remove');
            this.items.length = 0; // Clear items array

            var model = _.extend({
                _: _,
                description: '',
                shortDescription: '',
                related_links: null
            }, this.model.toJSON(), this.options);

            this.$el.addClass(this.className);
            this.$el.html(this.template(model));
            this.collection.map(_(this.addItem).bind(this));

            return this;
        },
        template: _.template(
            '<div class="dashboard-cell" style="width: 100%;">' +
                '<div class="dashboard-panel">' +
                    '<div class="dashboard-element" style="width: 100%;">' +
                        '<div class="panel-head"><h3><%= _("Description").t() %></h3></div>' +
                        '<div class="example-info">' +
                            '<p class="description"><%= description %></p>' +
                            '<% if(related_links && related_links.length) { %>' +
                            '<h5><%= _("Related examples:").t() %></h5>' +
                                '<ul class="related-links">' +
                                    '<% _.each(related_links, function(link) { %>' +
                                        '<li><a href="<%- link.href %>"><%- link.label %></a></li>' +
                                    '<% }); %>' +
                                '</ul>' +
                            '<% } %>' +
                        '</div>' +
                        '<div class="showsource-container">' +
                            '<h5><%= _("Source Code").t() %></h5>' +
                            '<ul class="nav nav-tabs"></ul>' +
                            '<div class="tab-content source-content"></div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>'
        )
    });

    return SourceCodeViewer;
});