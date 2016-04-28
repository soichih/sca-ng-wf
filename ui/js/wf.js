(function() {
    'use strict';
    var wf = angular.module('sca-wf', [
        'ngFileUpload', //for scaWfUploader
        'toaster',
    ]);

    //load tasks (and progress status) and refreshes preriodically
    wf.factory('scaTask', function(appconf, $http, $interval, toaster) {
      
        //tasks that we are keeping up with
        var tasks = {};

        function load(taskid) {
            $http.get(appconf.sca_api+'/task/', {params: {
                where: {_id: taskid},
            }}).then(function(res) {
                var _task = res.data[0];
                for(var k in _task) tasks[taskid][k] = _task[k]; //do inplace update
                delete tasks[taskid].loading;
            }, function(res) {
                if(res.data && res.data.message) toaster.error(res.data.message);
                else toaster.error(res.statusText);
            });
        }

        //reload tasks
        $interval(function() {
            //console.dir(tasks);
            var ids = Object.keys(tasks);
            var where = {_id: {$in: ids}};
            $http.get(appconf.sca_api+'/task/', {params: {where: where}}).then(function(res) {
                res.data.forEach(function(task) {
                    var taskid = task._id;
                    for(var k in task) tasks[taskid][k] = task[k]; //do inplace update
                });
            }, function(res) {
                if(res.data && res.data.message) toaster.error(res.data.message);
                else toaster.error(res.statusText);
            });
        }, 2500);

        //reload progress
        $interval(function() {
            //console.dir(tasks);
            for(var taskid in tasks) {
                let task = tasks[taskid];

                if(!task.progress_key) {
                    //no key, no progress
                    //task._progress = null;
                    continue; 
                }
                if(task.status == "finished" || task.status == "failed" || task.status == "stopped") {
                    //if finished, no need to load progress
                    task._progress = null; //I need to clear this so that proress will be reloaded when rerun (TODO need to test this case)
                    continue; 
                }
                if(task._progress && task._progress.status == "finished") {
                    //if progress is finished, no need to load again
                    //task._progress = null; //this causes flickering of task<>progress status because progress tends to finish before task
                    continue; 
                }

                $http.get(appconf.progress_api+'/status/'+task.progress_key).then(function(res) {
                    task._progress = res.data;
                }, function(res) {
                    if(res.data && res.data.message) toaster.error(res.data.message);
                    else toaster.error(res.statusText);
                });
            }
        }, 1000);

        return {
            get: function(taskid) {
                if(tasks[taskid]) return tasks[taskid];
                var task = {loading: true};
                tasks[taskid] = task;
                load(taskid);
                return task;
            }
        }
    });

    //displays task status, and if there is any dependencies, displays that as well
    wf.directive('scaWfTaskdeps', function(appconf, $http, toaster, $interval, scaTask) {
        return {
            restrict: 'E',
            //transclude: true,
            scope: {
                taskid: '<', 
            },
            //templateUrl: (scaSharedConfig.shared_url||"../shared")+'/t/menutab.html', 
            templateUrl: 'bower_components/sca-wf/ui/t/deps.html',  //TODO - should make this configurable..
            link: function ($scope, element) {
                //$scope.show_debug = {}; //contains task ids to show details
                $scope.task = scaTask.get($scope.taskid);
                $scope.appconf = appconf;

                //$scope.resource = null;
                $scope.tasks = null;
                          
                //load all deps tasks (once task.deps is loaded)
                //TODO - right now it only supports the end task and its dependencies. I need to support more complex dependencies
                $scope.$watchCollection('task', function(task) {
                    //only need to do once.. scaTask will refresh them
                    if(task.deps && !$scope.tasks) {
                        $scope.tasks = [];
                        task.deps.forEach(function(dep) {
                            $scope.tasks.push(scaTask.get(dep));
                        });
                        $scope.tasks.push($scope.task); //add the leaf task as last member of deps
                    }
                });

                $scope.stop = function(task) {
                    $http.put(appconf.sca_api+"/task/stop/"+task._id)
                    .then(function(res) {
                        toaster.success("Requested to stop this task");
                    }, function(res) {
                        if(res.data && res.data.message) toaster.error(res.data.message);
                        else toaster.error(res.statusText);
                    });
                }

                $scope.rerun = function(task) {
                    $http.put(appconf.sca_api+"/task/rerun/"+task._id)
                    .then(function(res) {
                        toaster.success("Requested to rerun this task");
                        //start_loading();
                    }, function(res) {
                        if(res.data && res.data.message) toaster.error(res.data.message);
                        else toaster.error(res.statusText);
                    });
                }
            }
        };
    });

    wf.directive('scaWfUploader', ['appconf', 'toaster', 'Upload', '$http', 
    function(appconf, toaster, Upload, $http ) {
        return {
            //restrict: 'E',
            scope: {
                instid: '<',
                taskid: '<',
                files: '=',
            }, 
            templateUrl: 'bower_components/sca-wf/ui/t/uploader.html', //TODO should be made configurable somehow
            link: function(scope, element) {
                scope.loaded = false;

                scope.files_uploading = [];

                //first find the best resource to upload files to
                scope.best_resource = null;
                $http.get(appconf.sca_api+"/resource/best", {params: {
                    service_id: "_upload",
                }})    
                .then(function(res) {
                    if(!res.data.resource) return; //no need to go further..
                    scope.best_resource = res.data;
                    
                    //then download files that are already uploaded to the resource
                    $http.get(appconf.sca_api+"/resource/ls", {params: {
                        resource_id: scope.best_resource.resource._id,
                        path: scope.best_resource.workdir+"/"+scope.instid+"/"+scope.taskid,
                    }})    
                    .then(function(res) {
                        scope.loaded = true;
                        scope.files = res.data.files;
                        //console.log("files loaded");
                        //console.dir(scope.files);
                    }, function(res) {
                        scope.loaded = true;
                        if(res.data && res.data.code && res.data.code == 2) {
                            console.log("upload directory doesn't exist yet, but that's ok");
                            scope.files = [];
                            return;
                        }
                        if(res.data && res.data.message) toaster.error(res.data.message);
                        else toaster.error(res.statusText);
                    });
                }, function(res) {
                    if(res.data && res.data.message) toaster.error(res.data.message);
                    else toaster.error(res.statusText);
                });

                /*
                scope.newfiles = [];
                scope.$watch('newfiles', function() {
                    console.log("newfiles");
                    scope.upload(scope.newfiles);
                });
                */

                //handles the actual file upload to the best resource found
                scope.uploadFiles = function(files) {
                    files.forEach(function(file) {
                        //make sure the same name already exist
                        var duplicate = false;
                        scope.files.forEach(function(_file) {
                            if(_file.filename == file.name) duplicate = true;
                        });
                        if(duplicate) {
                            toaster.warning(file.name+" already exists. Please delete the original file");
                            return;
                        }

                        scope.files_uploading.push(file);
                        file.upload = Upload.upload({
                            url: appconf.sca_api+"/resource/upload",
                            data: {
                                resource_id: scope.best_resource.resource._id,
                                path: scope.instid+"/"+scope.taskid,
                                file: file, 
                            }
                        });
                        file.upload.then(function(res) {
                            file.complete = true;
                            scope.files.push(res.data.file);
                            scope.$emit("file_uploaded", res.data.file);
                        }, function(res) {
                            if(res.data && res.data.message) toaster.error(res.data.message);
                            else toaster.error(res.statusText);
                            file.failed = true;
                            file.progress = 0;
                        }, function(event) {
                            if(event.loaded && event.total) file.progress = parseInt(100.0 * event.loaded / event.total);
                            else file.progress = 0;
                        });
                    });
                }
                scope.remove = function(file) {
                    var idx = scope.files.indexOf(file);
                    scope.files.splice(idx, 1);
                    $http.delete(appconf.sca_api+"/resource/file", {params: {
                        resource_id: scope.best_resource.resource._id,
                        path: scope.instid+"/"+scope.taskid+"/"+file.filename,
                    }})    
                    .then(function(res) {
                        console.dir(res.data);
                        //no news is good news
                    }, function(res) {
                        if(res.data && res.data.message) toaster.error(res.data.message);
                        else toaster.error(res.statusText);
                    });
                    
                }
                scope.download = function(file) {
                    var jwt = localStorage.getItem(appconf.jwt_id);
                    var path = scope.instid+"/"+scope.taskid+"/"+file.filename;
                    var url = appconf.sca_api+"/resource/download?r="+scope.best_resource.resource._id+"&p="+path+"&at="+jwt;
                    window.open(url, "_blank");
                    //window.location = url;
                    console.log("download");
                }
            }
        };
    }]);

    wf.filter('bytes', function() {
        return function(bytes, precision) {
            if (isNaN(parseFloat(bytes)) || !isFinite(bytes)) return '-';
            if (typeof precision === 'undefined') precision = 1;
            var units = ['bytes', 'kB', 'MB', 'GB', 'TB', 'PB'],
                number = Math.floor(Math.log(bytes) / Math.log(1024));
            return (bytes / Math.pow(1024, Math.floor(number))).toFixed(precision) +  ' ' + units[number];
        }
    });

})();

